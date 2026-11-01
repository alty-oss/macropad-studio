// Executor das etapas: abrir arquivos e sites, digitar texto e enviar atalhos.
use crate::{config::Step, virtual_keys::held_modifiers};
use std::{
    mem::size_of,
    ptr::{null, null_mut},
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

// O ShellExecute recomenda COM inicializado na thread que o chama.
pub fn init_thread() {
    unsafe {
        CoInitializeEx(null(), (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32);
    }
}

pub fn run(steps: &[Step], from_device: bool) -> Result<(), String> {
    if from_device {
        // O macropad ainda pode estar segurando o Ctrl/Shift da tecla virtual.
        let started = Instant::now();
        while held_modifiers() != 0 && started.elapsed() < Duration::from_millis(400) {
            thread::sleep(Duration::from_millis(10));
        }
    }
    for step in steps {
        match step {
            Step::Open { path, args } => shell_open(path, args)?,
            Step::Website { url } => shell_open(url, "")?,
            Step::Text { text } => type_text(text),
            Step::Hotkey { mods, code } => press_combo(*mods, *code)?,
            Step::Delay { ms } => thread::sleep(Duration::from_millis((*ms).min(60_000))),
        }
    }
    Ok(())
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

fn shell_open(target: &str, args: &str) -> Result<(), String> {
    let (operation, file, parameters) = (wide("open"), wide(target.trim()), wide(args.trim()));
    let parameters = if args.trim().is_empty() { null() } else { parameters.as_ptr() };
    let result = unsafe { ShellExecuteW(null_mut(), operation.as_ptr(), file.as_ptr(), parameters, null(), SW_SHOWNORMAL) };
    // Valores até 32 indicam erro, conforme a documentação do ShellExecute.
    if result as isize <= 32 {
        return Err(format!("Não foi possível abrir {target}."));
    }
    Ok(())
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

fn type_text(text: &str) {
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
        send(chunk);
        thread::sleep(Duration::from_millis(2));
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
