// Roteamento das teclas que o macropad usa para representar ações do app.
// A entrada chega pelo Raw Input, que identifica o próprio dispositivo e evita confundir F13–F24
// de um teclado comum com as teclas virtuais do macropad.
use crate::{config::Macro, executor::hid_from_scan};
use std::{
    collections::{HashMap, VecDeque},
    ptr::null_mut,
    sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock, RwLock},
    thread,
};
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::SystemInformation::GetTickCount,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LCONTROL, VK_LSHIFT, VK_RCONTROL, VK_RSHIFT},
        WindowsAndMessaging::{CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, MSG, WH_KEYBOARD_LL},
    },
};

const HID_F13: u8 = 0x68;
const HID_F24: u8 = 0x73;
const MODIFIER_BITS: [(u16, u8); 4] = [(VK_LCONTROL, 0x01), (VK_LSHIFT, 0x02), (VK_RCONTROL, 0x10), (VK_RSHIFT, 0x20)];

type Routes = HashMap<(u8, u8), (u8, u8)>;
static ROUTES: OnceLock<RwLock<Routes>> = OnceLock::new();
static PAUSED: AtomicBool = AtomicBool::new(false);
const FILTER_WINDOW_MS: u32 = 100;

#[derive(Clone, Copy)]
struct PendingInput {
    code: u8,
    down: bool,
    at: u32,
}

#[derive(Default)]
struct LegacyFilter {
    // Eventos vistos pelo Raw Input, que podem ser o mesmo evento que o Windows ainda
    // entregará como WM_KEYDOWN/WM_KEYUP. A fila é curta e expira em poucos milissegundos.
    pending: VecDeque<PendingInput>,
    last_virtual_at: Option<u32>,
}

static LEGACY_FILTER: OnceLock<Mutex<LegacyFilter>> = OnceLock::new();

pub fn paused() -> bool {
    PAUSED.load(Ordering::Relaxed)
}

pub fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::Relaxed);
}

// Instala um gancho somente para descartar a cópia legada de um evento que já foi confirmado
// pelo Raw Input como vindo do macropad. O gancho não bloqueia teclados arbitrários: sem o evento
// correspondente do dispositivo na fila, a mensagem segue para o Windows normalmente.
pub fn start_filter() {
    if LEGACY_FILTER.set(Mutex::new(LegacyFilter::default())).is_err() {
        return;
    }
    thread::spawn(|| unsafe {
        let handle = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), null_mut(), 0);
        if handle.is_null() {
            eprintln!("Nao foi possivel instalar o filtro de teclado do macropad.");
            return;
        }
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {}
    });
}

// Chamado pelo leitor de Raw Input antes de encaminhar a ação ao executor. Além da própria tecla
// virtual, mantemos uma janela curta para um código legado duplicado (por exemplo, Tab) que alguns
// firmwares podem emitir pela segunda coleção de teclado do mesmo aparelho.
pub fn observe_device_key(mods: u8, code: u8, down: bool) {
    let Some(filter) = LEGACY_FILTER.get() else { return };
    let now = unsafe { GetTickCount() };
    let virtual_key = !paused() && route_for(mods, code).is_some();
    let mut filter = filter.lock().unwrap();
    filter.pending.retain(|item| now.wrapping_sub(item.at) <= FILTER_WINDOW_MS);
    if virtual_key {
        filter.last_virtual_at = Some(now);
    }
    let duplicate_window = filter.last_virtual_at.is_some_and(|at| now.wrapping_sub(at) <= FILTER_WINDOW_MS);
    if virtual_key || duplicate_window {
        filter.pending.push_back(PendingInput { code, down, at: now });
    }
}

fn take_pending(code: u8, down: bool, at: u32) -> bool {
    let Some(filter) = LEGACY_FILTER.get() else { return false };
    let mut filter = filter.lock().unwrap();
    let position = filter.pending.iter().position(|item| {
        item.code == code && item.down == down && at.wrapping_sub(item.at) <= FILTER_WINDOW_MS && item.at.wrapping_sub(at) <= FILTER_WINDOW_MS
    });
    position.and_then(|index| filter.pending.remove(index)).is_some()
}

unsafe extern "system" fn keyboard_proc(code: i32, _wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        // LLKHF_UP = 0x80; LLKHF_EXTENDED = 0x01. Eventos injetados pelo próprio executor
        // nunca devem ser associados ao dispositivo físico.
        if info.flags & 0x10 == 0 {
            let down = info.flags & 0x80 == 0;
            if let Some(code) = hid_from_scan(info.scanCode as u16, info.flags & 0x01 != 0) {
                if take_pending(code, down, info.time) {
                    return 1;
                }
            }
        }
    }
    CallNextHookEx(null_mut(), code, _wparam, lparam)
}

// Modificadores atualmente segurados no teclado físico. Isso continua sendo usado ao executar
// atalhos, para não soltar um Ctrl ou Shift que o usuário já estava segurando.
pub fn held_modifiers() -> u8 {
    let down = |key: u16| unsafe { GetAsyncKeyState(key as i32) } < 0;
    MODIFIER_BITS.iter().filter(|(key, _)| down(*key)).fold(0, |bits, (_, bit)| bits | bit)
}

pub fn routes_for(macros: &[Macro]) -> Routes {
    macros
        .iter()
        .filter(|item| (HID_F13..=HID_F24).contains(&item.code))
        .map(|item| ((item.mods, item.code), (item.layer, item.slot)))
        .collect()
}

pub fn set_routes(macros: &[Macro]) {
    set_route_table(routes_for(macros));
}

pub fn set_route_table(routes: Routes) {
    *ROUTES.get_or_init(|| RwLock::new(HashMap::new())).write().unwrap() = routes;
}

pub fn route_for(mods: u8, code: u8) -> Option<(u8, u8)> {
    ROUTES.get()?.read().unwrap().get(&(mods, code)).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route_table() -> Routes {
        HashMap::from([((0, HID_F13), (1, 1)), ((0x02, HID_F13), (1, 16))])
    }

    #[test]
    fn rota_pura_nao_confunde_com_shift_do_teclado() {
        assert_eq!(route_table().get(&(0, HID_F13)), Some(&(1, 1)));
    }

    #[test]
    fn rota_com_shift_do_macropad_e_diferente() {
        assert_eq!(route_table().get(&(0x02, HID_F13)), Some(&(1, 16)));
    }

    #[test]
    fn modificador_do_teclado_nao_altera_a_rota_do_aparelho() {
        let routes = route_table();
        assert_eq!(routes.get(&(0, HID_F13)), Some(&(1, 1)));
    }
}
