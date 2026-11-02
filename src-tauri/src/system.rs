// Funções do Windows usadas pelas etapas: janela e programa em foco, elevação, controle de
// janelas, energia, mouse, brilho, sons, contador e área de transferência.
use std::{
    ffi::c_void,
    fs,
    mem::size_of,
    path::Path,
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use windows_sys::Win32::{
    Devices::Display::{
        DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
        GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
    },
    Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, RECT},
    Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
    Media::Multimedia::{mciGetErrorStringW, mciSendStringW},
    Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
    System::{
        DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData},
        Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
        Power::SetSuspendState,
        Registry::{RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD},
        Shutdown::LockWorkStation,
        SystemInformation::GetLocalTime,
        Threading::{
            AttachThreadInput, GetCurrentProcess, GetCurrentThreadId, OpenProcess, OpenProcessToken,
            QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        },
    },
    UI::Shell::ShellExecuteW,
    UI::{
        Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
            MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL,
            MOUSEINPUT,
        },
        WindowsAndMessaging::{
            BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId,
            IsIconic, IsWindowVisible, IsZoomed, PostMessageW, SendMessageTimeoutW, SetForegroundWindow, SetWindowPos,
            SetWindowLongPtrW, ShowWindow, GWL_EXSTYLE, GW_OWNER, HWND_BROADCAST, HWND_NOTOPMOST, HWND_TOPMOST,
            SMTO_ABORTIFHUNG, SWP_NOMOVE, SWP_NOSIZE, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, SW_SHOWNOACTIVATE, SW_SHOWNORMAL, WM_CLOSE,
            WM_SETTINGCHANGE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
        },
    },
};

const CF_UNICODETEXT: u32 = 13;

pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}

// Nome do executável de um processo, em minúsculas (por exemplo "photoshop.exe").
pub fn process_name(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buffer = [0u16; 1024];
        let mut length = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, buffer.as_mut_ptr(), &mut length);
        CloseHandle(process);
        if ok == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        Path::new(&path).file_name().map(|name| name.to_string_lossy().to_lowercase())
    }
}

fn window_process(window: HWND) -> u32 {
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(window, &mut pid) };
    pid
}

// Executável da janela em foco, para escolher o perfil da ação.
pub fn foreground_app() -> Option<String> {
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return None;
    }
    process_name(window_process(window))
}

fn token_elevated(process: HANDLE) -> Option<bool> {
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
            return None;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut size = 0;
        let ok = GetTokenInformation(token, TokenElevation, &mut elevation as *mut _ as *mut c_void, size_of::<TOKEN_ELEVATION>() as u32, &mut size);
        CloseHandle(token);
        (ok != 0).then_some(elevation.TokenIsElevated != 0)
    }
}

// O Windows (UIPI) descarta o SendInput destinado a janelas de programas elevados quando o app
// não é elevado. Sem acesso ao token da janela em foco, ela quase certamente é elevada.
pub fn foreground_blocks_input() -> bool {
    if token_elevated(unsafe { GetCurrentProcess() }) == Some(true) {
        return false;
    }
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return false;
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, window_process(window));
        if process.is_null() {
            return true;
        }
        let elevated = token_elevated(process);
        CloseHandle(process);
        elevated != Some(false)
    }
}

pub fn is_elevated() -> bool {
    token_elevated(unsafe { GetCurrentProcess() }).unwrap_or(false)
}

fn quote_windows_arg(arg: &str) -> String {
    if arg.is_empty() || arg.chars().any(char::is_whitespace) || arg.contains('"') {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
}

pub fn relaunch_as_admin(args: &[String]) -> Result<(), String> {
    let executable = std::env::current_exe().map_err(|error| format!("Não foi possível localizar o executável: {error}"))?;
    let mut parameters = args.iter().skip(1).map(|arg| quote_windows_arg(arg)).collect::<Vec<_>>();
    parameters.push("--macropad-elevated-relaunch".into());
    let executable = wide(&executable.to_string_lossy());
    let operation = wide("runas");
    let parameters = wide(&parameters.join(" "));
    let result = unsafe { ShellExecuteW(null_mut(), operation.as_ptr(), executable.as_ptr(), parameters.as_ptr(), null(), SW_SHOWNORMAL) };
    if (result as isize) <= 32 {
        Err("O Windows recusou a elevação do Macropad Studio.".into())
    } else {
        Ok(())
    }
}

unsafe extern "system" fn collect_app(window: HWND, data: LPARAM) -> BOOL {
    if IsWindowVisible(window) != 0 && GetWindow(window, GW_OWNER).is_null() {
        if let Some(name) = process_name(window_process(window)) {
            (*(data as *mut Vec<String>)).push(name);
        }
    }
    1
}

// Executáveis das janelas principais abertas agora.
pub fn window_apps() -> Vec<String> {
    let mut apps = Vec::new();
    unsafe { EnumWindows(Some(collect_app), &mut apps as *mut Vec<String> as LPARAM) };
    apps
}

// Mostra uma janela do app (o OSD) sem tirar o foco da janela atual e sem que ela possa recebê-lo.
pub fn show_without_focus(window: &tauri::WebviewWindow) {
    let Ok(handle) = window.hwnd() else { return };
    let handle = handle.0 as HWND;
    unsafe {
        let style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(handle, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize | WS_EX_TOOLWINDOW as isize);
        ShowWindow(handle, SW_SHOWNOACTIVATE);
    }
}

struct Search {
    name: String,
    found: HWND,
}

unsafe extern "system" fn find_window(window: HWND, data: LPARAM) -> BOOL {
    let search = &mut *(data as *mut Search);
    // Só janelas principais visíveis: sem dono, como as que aparecem na barra de tarefas.
    if IsWindowVisible(window) == 0 || !GetWindow(window, GW_OWNER).is_null() {
        return 1;
    }
    if process_name(window_process(window)).as_deref() == Some(search.name.as_str()) {
        search.found = window;
        return 0;
    }
    1
}

fn bring_to_front(window: HWND) {
    unsafe {
        if IsIconic(window) != 0 {
            ShowWindow(window, SW_RESTORE);
        }
        // O Windows só deixa trocar o foco quem participa da entrada atual: unimos a fila de
        // entrada à da janela em foco durante a troca.
        let foreground = GetForegroundWindow();
        let theirs = GetWindowThreadProcessId(foreground, null_mut());
        let ours = GetCurrentThreadId();
        AttachThreadInput(ours, theirs, 1);
        BringWindowToTop(window);
        SetForegroundWindow(window);
        AttachThreadInput(ours, theirs, 0);
    }
}

// Traz para frente a janela de um programa já aberto. false se ele não estiver aberto.
pub fn focus_program(path: &str) -> bool {
    let Some(name) = Path::new(path.trim()).file_name().map(|name| name.to_string_lossy().to_lowercase()) else { return false };
    let mut search = Search { name, found: null_mut() };
    unsafe { EnumWindows(Some(find_window), &mut search as *mut Search as LPARAM) };
    if search.found.is_null() {
        return false;
    }
    bring_to_front(search.found);
    true
}

pub fn window(action: &str) -> Result<String, String> {
    let window = unsafe { GetForegroundWindow() };
    if window.is_null() {
        return Err("Nenhuma janela em foco.".into());
    }
    unsafe {
        match action {
            "minimize" => {
                ShowWindow(window, SW_MINIMIZE);
            }
            "maximize" => {
                ShowWindow(window, if IsZoomed(window) != 0 { SW_RESTORE } else { SW_MAXIMIZE });
            }
            "close" => {
                PostMessageW(window, WM_CLOSE, 0, 0);
            }
            "topmost" => {
                let topmost = GetWindowLongPtrW(window, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0;
                SetWindowPos(window, if topmost { HWND_NOTOPMOST } else { HWND_TOPMOST }, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
                return Ok(if topmost { "Sempre no topo: não".into() } else { "Sempre no topo: sim".into() });
            }
            _ => return Err(format!("Ação de janela desconhecida: {action}.")),
        }
    }
    Ok(String::new())
}

const PERSONALIZE: &str = r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";

fn registry_dword(name: &str) -> Option<u32> {
    let (key, value) = (wide(PERSONALIZE), wide(name));
    let mut data = 0u32;
    let mut size = 4u32;
    let status = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), RRF_RT_REG_DWORD, null_mut(), &mut data as *mut u32 as *mut c_void, &mut size)
    };
    (status == 0).then_some(data)
}

fn toggle_theme() -> Result<String, String> {
    let light = registry_dword("AppsUseLightTheme").unwrap_or(0) == 0;
    let key = wide(PERSONALIZE);
    let data: u32 = light as u32;
    for name in ["AppsUseLightTheme", "SystemUsesLightTheme"] {
        let value = wide(name);
        let status = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), value.as_ptr(), REG_DWORD, &data as *const u32 as *const c_void, 4) };
        if status != 0 {
            return Err("Não foi possível trocar o tema do Windows.".into());
        }
    }
    // Avisa os programas abertos para redesenharem com o novo tema.
    let topic = wide("ImmersiveColorSet");
    unsafe { SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, topic.as_ptr() as LPARAM, SMTO_ABORTIFHUNG, 200, null_mut()) };
    Ok(if light { "Tema claro".into() } else { "Tema escuro".into() })
}

pub fn system(action: &str) -> Result<String, String> {
    let run = |program: &str, args: &[&str]| {
        std::process::Command::new(program).args(args).spawn().map(|_| String::new()).map_err(|e| e.to_string())
    };
    match action {
        "lock" => {
            unsafe { LockWorkStation() };
            Ok(String::new())
        }
        "sleep" => {
            unsafe { SetSuspendState(0, 0, 0) };
            Ok(String::new())
        }
        "shutdown" => run("shutdown", &["/s", "/t", "0"]),
        "restart" => run("shutdown", &["/r", "/t", "0"]),
        "theme" => toggle_theme(),
        _ => Err(format!("Ação de sistema desconhecida: {action}.")),
    }
}

fn mouse_input(flags: u32, data: i32) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: data as u32, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

pub fn mouse(action: &str, amount: i32) -> Result<(), String> {
    const WHEEL_DELTA: i32 = 120;
    let inputs = match action {
        "left" => vec![mouse_input(MOUSEEVENTF_LEFTDOWN, 0), mouse_input(MOUSEEVENTF_LEFTUP, 0)],
        "right" => vec![mouse_input(MOUSEEVENTF_RIGHTDOWN, 0), mouse_input(MOUSEEVENTF_RIGHTUP, 0)],
        "middle" => vec![mouse_input(MOUSEEVENTF_MIDDLEDOWN, 0), mouse_input(MOUSEEVENTF_MIDDLEUP, 0)],
        "scrollUp" => vec![mouse_input(MOUSEEVENTF_WHEEL, amount * WHEEL_DELTA)],
        "scrollDown" => vec![mouse_input(MOUSEEVENTF_WHEEL, -amount * WHEEL_DELTA)],
        "scrollRight" => vec![mouse_input(MOUSEEVENTF_HWHEEL, amount * WHEEL_DELTA)],
        "scrollLeft" => vec![mouse_input(MOUSEEVENTF_HWHEEL, -amount * WHEEL_DELTA)],
        _ => return Err(format!("Ação de mouse desconhecida: {action}.")),
    };
    unsafe { SendInput(inputs.len() as u32, inputs.as_ptr(), size_of::<INPUT>() as i32) };
    Ok(())
}

unsafe extern "system" fn collect_monitor(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
    (*(data as *mut Vec<HMONITOR>)).push(monitor);
    1
}

// Brilho dos monitores externos por DDC/CI. Monitores sem DDC/CI (e telas de notebook) são ignorados.
pub fn brightness(change: i32) -> Result<String, String> {
    let mut monitors: Vec<HMONITOR> = Vec::new();
    unsafe { EnumDisplayMonitors(null_mut(), null(), Some(collect_monitor), &mut monitors as *mut _ as LPARAM) };
    let mut levels = Vec::new();
    for monitor in monitors {
        unsafe {
            let mut count = 0;
            if GetNumberOfPhysicalMonitorsFromHMONITOR(monitor, &mut count) == 0 || count == 0 {
                continue;
            }
            let mut physical: Vec<PHYSICAL_MONITOR> = vec![std::mem::zeroed(); count as usize];
            if GetPhysicalMonitorsFromHMONITOR(monitor, count, physical.as_mut_ptr()) == 0 {
                continue;
            }
            for item in &physical {
                let (mut min, mut current, mut max) = (0, 0, 0);
                if GetMonitorBrightness(item.hPhysicalMonitor, &mut min, &mut current, &mut max) == 0 || max <= min {
                    continue;
                }
                let span = (max - min) as i32;
                let next = (current as i32 + change * span / 100).clamp(min as i32, max as i32) as u32;
                if SetMonitorBrightness(item.hPhysicalMonitor, next) != 0 {
                    levels.push((next - min) * 100 / (max - min));
                }
            }
            DestroyPhysicalMonitors(count, physical.as_ptr());
        }
    }
    match levels.first() {
        Some(level) => Ok(format!("Brilho · {level}%")),
        None => Err("Nenhum monitor aceitou o ajuste de brilho (DDC/CI desligado ou não suportado).".into()),
    }
}

static SOUNDS: AtomicU32 = AtomicU32::new(0);
static SOUND_VOLUME: AtomicU32 = AtomicU32::new(100);

pub fn set_sound_volume(volume: u8) {
    SOUND_VOLUME.store(volume.min(100) as u32, Ordering::Relaxed);
}

// Um comando MCI; o erro vem com o texto do próprio Windows.
fn mci(command: &str) -> Result<(), String> {
    let code = unsafe { mciSendStringW(wide(command).as_ptr(), null_mut(), 0, null_mut()) };
    if code == 0 {
        return Ok(());
    }
    let mut message = [0u16; 256];
    unsafe { mciGetErrorStringW(code, message.as_mut_ptr(), message.len() as u32) };
    let length = message.iter().position(|&unit| unit == 0).unwrap_or(0);
    Err(format!("erro {code}: {}", String::from_utf16_lossy(&message[..length])))
}

// Toca um arquivo de áudio (MP3, WAV…) sem esperar o fim, como numa soundboard. O resultado da
// abertura volta para quem chamou: um arquivo que o Windows não consegue tocar vira um aviso, em
// vez de silêncio.
pub fn sound(path: &str) -> Result<(), String> {
    let path = path.trim().to_string();
    if !Path::new(&path).is_file() {
        return Err(format!("Arquivo de som não encontrado: {path}."));
    }
    let alias = format!("macropad{}", SOUNDS.fetch_add(1, Ordering::Relaxed));
    let (opened, result) = mpsc::channel();
    let file = path.clone();
    thread::spawn(move || {
        // O dispositivo é escolhido pela extensão (MP3 pelo mpegvideo, WAV pelo waveaudio).
        let open = mci(&format!("open \"{file}\" alias {alias}"));
        let ok = open.is_ok();
        opened.send(open).ok();
        if ok {
            let volume = SOUND_VOLUME.load(Ordering::Relaxed) * 10;
            mci(&format!("setaudio {alias} volume to {volume}")).ok();
            mci(&format!("play {alias} wait")).ok();
            mci(&format!("close {alias}")).ok();
        }
    });
    match result.recv_timeout(Duration::from_secs(3)) {
        Ok(Err(error)) => Err(format!("Não foi possível tocar {path}: {error}")),
        _ => Ok(()),
    }
}

// Soma ao número guardado num arquivo de texto (0 zera), por exemplo para uma fonte de texto do OBS.
pub fn counter(path: &str, change: i64) -> Result<String, String> {
    let path = Path::new(path.trim());
    let current: i64 = fs::read_to_string(path).ok().and_then(|text| text.trim().parse().ok()).unwrap_or(0);
    let next = if change == 0 { 0 } else { current.saturating_add(change) };
    fs::write(path, next.to_string()).map_err(|e| format!("Não foi possível gravar o contador: {e}"))?;
    Ok(format!("Contador · {next}"))
}

fn open_clipboard() -> bool {
    // Outro programa pode estar com a área de transferência aberta por alguns milissegundos.
    for _ in 0..10 {
        if unsafe { OpenClipboard(null_mut()) } != 0 {
            return true;
        }
        thread::sleep(Duration::from_millis(20));
    }
    false
}

pub fn clipboard_text() -> Option<String> {
    if !open_clipboard() {
        return None;
    }
    unsafe {
        let handle = GetClipboardData(CF_UNICODETEXT);
        let text = if handle.is_null() {
            None
        } else {
            let pointer = GlobalLock(handle) as *const u16;
            if pointer.is_null() {
                None
            } else {
                let length = (0..).take_while(|&i| *pointer.add(i) != 0).count();
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
                GlobalUnlock(handle);
                Some(text)
            }
        };
        CloseClipboard();
        text
    }
}

pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    if !open_clipboard() {
        return Err("A área de transferência está ocupada por outro programa.".into());
    }
    let units = wide(text);
    unsafe {
        EmptyClipboard();
        let memory = GlobalAlloc(GMEM_MOVEABLE, units.len() * 2);
        let ok = !memory.is_null() && {
            let pointer = GlobalLock(memory) as *mut u16;
            if !pointer.is_null() {
                std::ptr::copy_nonoverlapping(units.as_ptr(), pointer, units.len());
                GlobalUnlock(memory);
            }
            !pointer.is_null() && !SetClipboardData(CF_UNICODETEXT, memory).is_null()
        };
        CloseClipboard();
        if ok { Ok(()) } else { Err("Não foi possível usar a área de transferência.".into()) }
    }
}

// Data e hora locais no formato brasileiro, para as variáveis {data} e {hora}.
pub fn local_date_time() -> (String, String) {
    let mut now = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut now) };
    let now: windows_sys::Win32::Foundation::SYSTEMTIME = now;
    (format!("{:02}/{:02}/{}", now.wDay, now.wMonth, now.wYear), format!("{:02}:{:02}", now.wHour, now.wMinute))
}

pub fn file_timestamp() -> String {
    let mut now = unsafe { std::mem::zeroed() };
    unsafe { GetLocalTime(&mut now) };
    let now: windows_sys::Win32::Foundation::SYSTEMTIME = now;
    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contador_soma_e_zera() {
        let path = std::env::temp_dir().join(format!("macropad-contador-{}.txt", std::process::id()));
        fs::write(&path, "41\n").unwrap();
        assert_eq!(counter(path.to_str().unwrap(), 1).unwrap(), "Contador · 42");
        assert_eq!(counter(path.to_str().unwrap(), -2).unwrap(), "Contador · 40");
        assert_eq!(counter(path.to_str().unwrap(), 0).unwrap(), "Contador · 0");
        fs::remove_file(path).ok();
    }
}
