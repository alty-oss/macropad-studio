// Executor das ações do app. Cada (camada, slot) tem uma thread própria: uma macro longa não
// atrasa as outras teclas, e giros de knob que chegam durante uma execução são somados.
use crate::{
    audio,
    config::{Macro, Mode, Step},
    integrations, system,
    obs::Obs,
    virtual_keys::held_modifiers,
};
use std::{
    collections::HashMap,
    mem::size_of,
    os::windows::process::CommandExt,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE},
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
            KEYEVENTF_SCANCODE, KEYEVENTF_UNICODE, VK_RETURN,
        },
        Shell::ShellExecuteW,
        WindowsAndMessaging::SW_SHOWNORMAL,
    },
};

// Segurar a tecla por mais que isto executa as etapas de "segurar" (modo Hold).
const HOLD: Duration = Duration::from_millis(450);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// "Parar ações em execução" incrementa a geração; as execuções em andamento param na próxima etapa.
static GENERATION: AtomicU64 = AtomicU64::new(0);

pub fn cancel_all() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

// O ShellExecute (e o Core Audio) pedem COM inicializado na thread que os chama.
pub fn init_thread() {
    unsafe {
        CoInitializeEx(null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
    }
}

// O que o executor precisa do resto do app.
pub trait Host: Send + Sync + 'static {
    fn lookup(&self, layer: u8, slot: u8) -> Option<Macro>;
    fn obs(&self) -> &'static Obs;
    // Tecla virtual pressionada ou solta, para a interface acompanhar.
    fn pressed(&self, layer: u8, slot: u8, down: bool);
    // Resultado de uma execução: textos para o OSD, avisos e o erro, se houver.
    fn report(&self, origin: Option<(u8, u8)>, steps: &[Step], outcome: Outcome);
}

#[derive(Default)]
pub struct Outcome {
    pub feedback: Vec<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

pub enum Job {
    Key(u8, u8, bool),
    Run(Vec<Step>),
}

// Distribui os eventos: cada slot tem sua fila e sua thread; os testes da interface, outra.
pub fn spawn(host: Arc<dyn Host>) -> mpsc::Sender<Job> {
    let (jobs, queue) = mpsc::channel::<Job>();
    thread::spawn(move || {
        let mut workers: HashMap<(u8, u8), mpsc::Sender<bool>> = HashMap::new();
        let (tests, test_queue) = mpsc::channel::<Vec<Step>>();
        let test_host = host.clone();
        thread::spawn(move || {
            init_thread();
            for steps in test_queue {
                let outcome = execute(test_host.as_ref(), &steps, false);
                test_host.report(None, &steps, outcome);
            }
        });
        for job in queue {
            match job {
                Job::Run(steps) => {
                    tests.send(steps).ok();
                }
                Job::Key(layer, slot, down) => {
                    host.pressed(layer, slot, down);
                    let worker = workers.entry((layer, slot)).or_insert_with(|| {
                        let (events, receiver) = mpsc::channel();
                        let host = host.clone();
                        thread::spawn(move || slot_worker(host.as_ref(), layer, slot, receiver));
                        events
                    });
                    worker.send(down).ok();
                }
            }
        }
    });
    jobs
}

// Etapas do perfil do programa em foco, ou as etapas padrão.
fn resolve(item: &Macro) -> Vec<Step> {
    if !item.profiles.is_empty() {
        if let Some(app) = system::foreground_app() {
            if let Some(profile) = item.profiles.iter().find(|profile| profile.app.trim().eq_ignore_ascii_case(&app)) {
                return profile.steps.clone();
            }
        }
    }
    item.steps.clone()
}

fn slot_worker(host: &dyn Host, layer: u8, slot: u8, events: mpsc::Receiver<bool>) {
    init_thread();
    let mut toggled = false;
    let run = |steps: &[Step]| {
        let outcome = execute(host, steps, true);
        host.report(Some((layer, slot)), steps, outcome);
    };
    while let Ok(down) = events.recv() {
        if !down {
            continue;
        }
        let Some(item) = host.lookup(layer, slot) else { continue };
        match item.mode {
            Mode::Normal => {
                // Pressões (ou giros do knob) que chegaram enquanto a anterior rodava viram uma
                // execução só, repetida, sem esperar o modificador de novo a cada vez.
                let mut times = 1;
                while let Ok(next) = events.try_recv() {
                    times += next as usize;
                }
                let steps = resolve(&item);
                let repeated: Vec<Step> = (0..times).flat_map(|_| steps.iter().cloned()).collect();
                run(&repeated);
            }
            Mode::Toggle => {
                let steps = if toggled { item.alt.clone() } else { resolve(&item) };
                toggled = !toggled;
                run(&steps);
            }
            Mode::Hold => match events.recv_timeout(HOLD) {
                Ok(_) => run(&resolve(&item)),
                Err(mpsc::RecvTimeoutError::Timeout) => run(&item.alt),
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            },
        }
    }
}

const ELEVATED: &str = "A janela em foco roda como administrador, e o Windows bloqueia texto, atalhos e cliques vindos de programas comuns. Para controlá-la, abra o Macropad Studio como administrador.";

// Executa as etapas em ordem. Para na primeira que falhar ou quando as ações forem canceladas.
pub fn execute(host: &dyn Host, steps: &[Step], from_device: bool) -> Outcome {
    let generation = GENERATION.load(Ordering::SeqCst);
    let mut outcome = Outcome::default();
    if from_device {
        // O macropad ainda pode estar segurando o Ctrl/Shift da tecla virtual. Se continuar
        // segurando (tecla mantida pressionada), soltamos para não somar ao atalho.
        let started = Instant::now();
        while held_modifiers() != 0 && started.elapsed() < Duration::from_millis(400) {
            thread::sleep(Duration::from_millis(10));
        }
        release_modifiers();
    }
    for step in steps {
        if GENERATION.load(Ordering::SeqCst) != generation {
            outcome.warnings.push("Ação interrompida.".into());
            break;
        }
        let needs_input = matches!(step, Step::Text { .. } | Step::Hotkey { .. } | Step::Mouse { .. });
        if needs_input && system::foreground_blocks_input() && !outcome.warnings.iter().any(|w| w == ELEVATED) {
            outcome.warnings.push(ELEVATED.into());
        }
        match run_step(host, step, generation) {
            Ok(text) if text.is_empty() => {}
            Ok(text) => outcome.feedback.push(text),
            Err(error) => {
                outcome.error = Some(error);
                break;
            }
        }
    }
    outcome
}

fn cancelled(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) != generation
}

fn sleep(ms: u64, generation: u64) {
    let until = Instant::now() + Duration::from_millis(ms.min(60_000));
    while Instant::now() < until && !cancelled(generation) {
        thread::sleep(until.saturating_duration_since(Instant::now()).min(Duration::from_millis(25)));
    }
}

fn run_step(host: &dyn Host, step: &Step, generation: u64) -> Result<String, String> {
    let done = |result: Result<(), String>| result.map(|_| String::new());
    match step {
        Step::Open { path, args, focus } => {
            if *focus && system::focus_program(path) {
                return Ok(String::new());
            }
            done(shell_open(path, args))
        }
        Step::Website { url } => done(shell_open(url, "")),
        Step::Text { text, paste } => {
            let text = expand_variables(text);
            if *paste { done(paste_text(&text)) } else { done(type_text(&text, generation)) }
        }
        Step::Hotkey { mods, code } => done(press_combo(*mods, *code)),
        Step::Delay { ms } => {
            sleep(*ms, generation);
            Ok(String::new())
        }
        Step::Media { key } => done(media_key(key)),
        Step::Command { command, hidden } => done(run_command(command, *hidden)),
        Step::Http { method, url, headers, body } => integrations::http(method, url, headers, body),
        Step::Audio { target, app, action, amount } => audio::run(target, app, action, *amount),
        Step::Window { action } if action == "nextMonitor" => done(press_combo(0x08 | 0x02, 0x4f)),
        Step::Window { action } => system::window(action),
        Step::System { action } => system::system(action),
        Step::Mouse { action, amount } => done(system::mouse(action, *amount)),
        Step::Sound { path } => done(system::sound(path)),
        Step::Counter { path, change } => system::counter(path, *change),
        Step::Brightness { change } => system::brightness(*change),
        Step::Obs { action, scene, source, amount, path } => host.obs().run_action(action, scene, source, *amount, path),
        Step::Removed => Ok(String::new()),
        Step::Voicemeeter { parameter, mode, value } => integrations::voicemeeter(parameter, mode, *value),
        Step::Player { app, action } => audio::player(app, action),
    }
}

// Variáveis do texto: {data}, {hora} e {clipboard}.
pub fn expand_variables(text: &str) -> String {
    if !text.contains('{') {
        return text.to_string();
    }
    let (date, time) = system::local_date_time();
    let mut result = text.replace("{data}", &date).replace("{hora}", &time);
    if result.contains("{clipboard}") {
        result = result.replace("{clipboard}", &system::clipboard_text().unwrap_or_default());
    }
    result
}

fn shell_open(target: &str, args: &str) -> Result<(), String> {
    let (operation, file, parameters) = (system::wide("open"), system::wide(target.trim()), system::wide(args.trim()));
    let parameters = if args.trim().is_empty() { null() } else { parameters.as_ptr() };
    let result = unsafe { ShellExecuteW(null_mut(), operation.as_ptr(), file.as_ptr(), parameters, null(), SW_SHOWNORMAL) };
    // Valores até 32 indicam erro, conforme a documentação do ShellExecute.
    if result as isize <= 32 {
        return Err(format!("Não foi possível abrir {target}."));
    }
    Ok(())
}

// Roda pelo cmd. Oculto, o comando não abre janela; um código de saída diferente de zero não é
// acompanhado, porque o comando pode continuar rodando depois da ação.
fn run_command(command: &str, hidden: bool) -> Result<(), String> {
    let mut process = std::process::Command::new("cmd");
    process.raw_arg(format!("/C {}", command.trim()));
    if hidden {
        process.creation_flags(CREATE_NO_WINDOW);
    }
    process.spawn().map(|_| ()).map_err(|e| format!("Não foi possível executar o comando: {e}"))
}

fn key_input(scan: u16, virtual_key: u16, flags: u32) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: virtual_key, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn send(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32);
    }
}

// Solta os modificadores que continuam pressionados (pelo macropad, numa tecla mantida).
fn release_modifiers() {
    let held = held_modifiers();
    let inputs: Vec<INPUT> = MODIFIERS
        .iter()
        .filter(|(bit, ..)| held & bit != 0)
        .map(|(_, scan, extended)| key_input(*scan, 0, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP | if *extended { KEYEVENTF_EXTENDEDKEY } else { 0 }))
        .collect();
    if !inputs.is_empty() {
        send(&inputs);
    }
}

fn type_text(text: &str, generation: u64) -> Result<(), String> {
    let mut inputs = Vec::new();
    for unit in text.replace("\r\n", "\n").encode_utf16() {
        if unit == '\n' as u16 {
            inputs.push(key_input(0, VK_RETURN, 0));
            inputs.push(key_input(0, VK_RETURN, KEYEVENTF_KEYUP));
        } else {
            inputs.push(key_input(unit, 0, KEYEVENTF_UNICODE));
            inputs.push(key_input(unit, 0, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
        }
    }
    for chunk in inputs.chunks(64) {
        if cancelled(generation) {
            break;
        }
        send(chunk);
        thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}

// Cola pela área de transferência (Ctrl+V) e depois devolve o que estava nela.
fn paste_text(text: &str) -> Result<(), String> {
    let previous = system::clipboard_text();
    system::set_clipboard_text(text)?;
    press_combo(0x01, 0x19)?;
    // O programa de destino lê a área de transferência depois de receber o Ctrl+V.
    thread::sleep(Duration::from_millis(250));
    if let Some(previous) = previous {
        system::set_clipboard_text(&previous).ok();
    }
    Ok(())
}

// Teclas de mídia e volume do Windows, para uso dentro de multi-ações.
fn media_key(key: &str) -> Result<(), String> {
    let code: u16 = match key {
        "playPause" => 0xb3,
        "next" => 0xb0,
        "prev" => 0xb1,
        "stop" => 0xb2,
        "volumeUp" => 0xaf,
        "volumeDown" => 0xae,
        "mute" => 0xad,
        _ => return Err(format!("Tecla de mídia desconhecida: {key}.")),
    };
    send(&[key_input(0, code, KEYEVENTF_EXTENDEDKEY), key_input(0, code, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP)]);
    Ok(())
}

// Texto curto que descreve uma etapa, para o OSD.
pub fn describe(step: &Step) -> String {
    let file_name = |path: &str| path.split(['\\', '/']).rfind(|part| !part.is_empty()).unwrap_or(path).to_string();
    match step {
        Step::Open { path, .. } => file_name(path),
        Step::Website { url } => url.trim_start_matches("https://").trim_start_matches("http://").split('/').next().unwrap_or(url).to_string(),
        Step::Text { .. } => "Texto digitado".into(),
        Step::Hotkey { .. } => "Atalho".into(),
        Step::Delay { .. } => "Aguardar".into(),
        Step::Media { .. } => "Mídia".into(),
        Step::Command { .. } => "Comando".into(),
        Step::Http { url, .. } => url.trim_start_matches("https://").trim_start_matches("http://").split('/').next().unwrap_or(url).to_string(),
        Step::Audio { .. } => "Áudio".into(),
        Step::Window { .. } => "Janela".into(),
        Step::System { .. } => "Sistema".into(),
        Step::Mouse { .. } => "Mouse".into(),
        Step::Sound { path } => file_name(path),
        Step::Counter { .. } => "Contador".into(),
        Step::Brightness { .. } => "Brilho".into(),
        Step::Obs { .. } => "OBS".into(),
        Step::Removed => String::new(),
        Step::Voicemeeter { parameter, .. } => parameter.clone(),
        Step::Player { .. } => "Player".into(),
    }
}

// Bits HID dos modificadores e seus scancodes (conjunto 1).
const MODIFIERS: [(u8, u16, bool); 8] = [
    (0x01, 0x1d, false),
    (0x02, 0x2a, false),
    (0x04, 0x38, false),
    (0x08, 0x5b, true),
    (0x10, 0x1d, true),
    (0x20, 0x36, false),
    (0x40, 0x38, true),
    (0x80, 0x5c, true),
];

// Uso HID → scancode, para que o atalho siga a posição física da tecla, como no macropad.
fn scan_code(code: u8) -> Option<(u16, bool)> {
    const LETTERS: [u16; 26] = [
        0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26, 0x32, 0x31, 0x18, 0x19, 0x10, 0x13,
        0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d, 0x15, 0x2c,
    ];
    const KEYPAD: [u16; 11] = [0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49, 0x52, 0x53];
    const F13_F24: [u16; 12] = [0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x76];
    let plain = |scan: u16| Some((scan, false));
    let extended = |scan: u16| Some((scan, true));
    match code {
        0x04..=0x1d => plain(LETTERS[(code - 0x04) as usize]),
        0x1e..=0x27 => plain(0x02 + (code - 0x1e) as u16),
        0x28 => plain(0x1c),
        0x29 => plain(0x01),
        0x2a => plain(0x0e),
        0x2b => plain(0x0f),
        0x2c => plain(0x39),
        0x2d => plain(0x0c),
        0x2e => plain(0x0d),
        0x2f => plain(0x1a),
        0x30 => plain(0x1b),
        0x31 => plain(0x2b),
        0x33 => plain(0x27),
        0x34 => plain(0x28),
        0x35 => plain(0x29),
        0x36 => plain(0x33),
        0x37 => plain(0x34),
        0x38 => plain(0x35),
        0x39 => plain(0x3a),
        0x3a..=0x43 => plain(0x3b + (code - 0x3a) as u16),
        0x44 => plain(0x57),
        0x45 => plain(0x58),
        0x46 => extended(0x37),
        0x47 => plain(0x46),
        // O Windows troca Pause e NumLock: Pause é 0x45 simples, NumLock é 0x45 estendido.
        0x48 => plain(0x45),
        0x49 => extended(0x52),
        0x4a => extended(0x47),
        0x4b => extended(0x49),
        0x4c => extended(0x53),
        0x4d => extended(0x4f),
        0x4e => extended(0x51),
        0x4f => extended(0x4d),
        0x50 => extended(0x4b),
        0x51 => extended(0x50),
        0x52 => extended(0x48),
        0x53 => extended(0x45),
        0x54 => extended(0x35),
        0x55 => plain(0x37),
        0x56 => plain(0x4a),
        0x57 => plain(0x4e),
        0x58 => extended(0x1c),
        0x59..=0x63 => plain(KEYPAD[(code - 0x59) as usize]),
        0x64 => plain(0x56),
        0x65 => extended(0x5d),
        0x68..=0x73 => plain(F13_F24[(code - 0x68) as usize]),
        0x87 => plain(0x73),
        _ => None,
    }
}

// O caminho inverso, para reconhecer as teclas que o macropad envia (device_input.rs).
pub fn hid_from_scan(scan: u16, extended: bool) -> Option<u8> {
    (0..=u8::MAX).find(|&code| scan_code(code) == Some((scan, extended)))
}

fn press_combo(mods: u8, code: u8) -> Result<(), String> {
    let (scan, extended) = scan_code(code).ok_or_else(|| format!("Tecla 0x{code:02x} não suportada em atalhos."))?;
    let key = |scan: u16, extended: bool, up: bool| {
        let mut flags = KEYEVENTF_SCANCODE;
        if extended {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        key_input(scan, 0, flags)
    };
    let active: Vec<_> = MODIFIERS.iter().filter(|(bit, ..)| mods & bit != 0).collect();
    let mut inputs: Vec<INPUT> = active.iter().map(|(_, scan, extended)| key(*scan, *extended, false)).collect();
    inputs.push(key(scan, extended, false));
    inputs.push(key(scan, extended, true));
    inputs.extend(active.iter().rev().map(|(_, scan, extended)| key(*scan, *extended, true)));
    send(&inputs);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letras_e_setas_viram_scancodes() {
        assert_eq!(scan_code(0x04), Some((0x1e, false)));
        assert_eq!(scan_code(0x4f), Some((0x4d, true)));
        assert_eq!(scan_code(0x68), Some((0x64, false)));
        assert_eq!(scan_code(0x73), Some((0x76, false)));
        assert_eq!(scan_code(0x01), None);
    }

    #[test]
    fn todas_as_teclas_do_editor_tem_scancode() {
        // Usos HID do teclado virtual (src/device/keys.ts), exceto F13–F24, que vêm a seguir.
        let codes = (0x04..=0x31).chain(0x33..=0x65).chain([0x87]);
        for code in codes {
            assert!(scan_code(code).is_some(), "uso 0x{code:02x} sem scancode");
        }
    }

    #[test]
    fn texto_sem_variaveis_fica_igual() {
        assert_eq!(expand_variables("Olá, {nome}"), "Olá, {nome}");
        assert!(!expand_variables("{data} {hora}").contains('{'));
    }
}
