// Teclas virtuais: o macropad envia F13–F24 (às vezes com Ctrl/Shift). Este gancho de
// teclado de baixo nível as reconhece antes dos outros programas, impede que cheguem a
// eles e avisa o executor qual (camada, slot) foi acionado.
use crate::config::Macro;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock, RwLock,
    },
    thread,
};
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LCONTROL, VK_LSHIFT, VK_RCONTROL, VK_RSHIFT},
        WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
            WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
        },
    },
};

const HID_F13: u8 = 0x68;
const HID_F24: u8 = 0x73;
const VK_F13: u32 = 0x7c;
const VK_F24: u32 = 0x87;
// Modificadores que as teclas virtuais usam, com o bit HID de cada um.
const MODIFIER_BITS: [(u16, u8); 4] = [(VK_LCONTROL, 0x01), (VK_LSHIFT, 0x02), (VK_RCONTROL, 0x10), (VK_RSHIFT, 0x20)];
// O macropad envia o modificador e a tecla no mesmo relatório: os dois chegam quase juntos.
const SAME_REPORT_MS: u32 = 50;
// Sem repetição automática por tanto tempo, a tecla foi solta e o keyup se perdeu.
const STUCK_MS: u32 = 1000;

// Recebe (camada, slot, true) ao pressionar a tecla virtual e (camada, slot, false) ao soltar.
type Fired = Box<dyn Fn(u8, u8, bool) + Send + Sync>;

#[derive(Default)]
struct Keys {
    // Tecla virtual segurada → (rota, horário do último keydown).
    held: HashMap<u32, ((u8, u8), u32)>,
    // Modificador → horário em que passou de solto a pressionado.
    modifiers_down: HashMap<u16, u32>,
}

struct Hook {
    routes: RwLock<HashMap<(u8, u32), (u8, u8)>>,
    keys: Mutex<Keys>,
    fired: Fired,
}

static HOOK: OnceLock<Hook> = OnceLock::new();
// Pausado, o gancho deixa as teclas virtuais passarem para os programas sem executar nada.
static PAUSED: AtomicBool = AtomicBool::new(false);

pub fn paused() -> bool {
    PAUSED.load(Ordering::Relaxed)
}

pub fn set_paused(paused: bool) {
    PAUSED.store(paused, Ordering::Relaxed);
}

// Modificadores no formato de bits HID usado pelo firmware.
pub fn held_modifiers() -> u8 {
    let down = |key: u16| unsafe { GetAsyncKeyState(key as i32) } < 0;
    MODIFIER_BITS.iter().filter(|(key, _)| down(*key)).fold(0, |bits, (_, bit)| bits | bit)
}

pub fn start(fired: impl Fn(u8, u8, bool) + Send + Sync + 'static) {
    let hook = Hook { routes: RwLock::default(), keys: Mutex::default(), fired: Box::new(fired) };
    if HOOK.set(hook).is_err() {
        return;
    }
    thread::spawn(|| unsafe {
        let handle = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), std::ptr::null_mut(), 0);
        if handle.is_null() {
            eprintln!("Não foi possível instalar o gancho de teclado.");
            return;
        }
        // O gancho de baixo nível só é chamado enquanto esta thread processa mensagens.
        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {}
    });
}

pub fn routes_for(macros: &[Macro]) -> HashMap<(u8, u32), (u8, u8)> {
    macros
        .iter()
        .filter(|item| (HID_F13..=HID_F24).contains(&item.code))
        .map(|item| ((item.mods, VK_F13 + (item.code - HID_F13) as u32), (item.layer, item.slot)))
        .collect()
}

pub fn set_routes(macros: &[Macro]) {
    set_route_table(routes_for(macros));
}

pub fn set_route_table(routes: HashMap<(u8, u32), (u8, u8)>) {
    let Some(hook) = HOOK.get() else { return };
    *hook.routes.write().unwrap() = routes;
}

// Modificadores que acabaram de ser pressionados, provavelmente pelo próprio macropad. Os que
// o usuário já segurava no teclado de verdade ficam de fora, para não trocar a rota.
fn recent_modifiers(keys: &Keys, now: u32) -> u8 {
    MODIFIER_BITS
        .iter()
        .filter(|(key, _)| keys.modifiers_down.get(key).is_some_and(|&at| now.wrapping_sub(at) <= SAME_REPORT_MS))
        .fold(0, |bits, (_, bit)| bits | bit)
}

fn find_route(routes: &HashMap<(u8, u32), (u8, u8)>, recent: u8, held: u8, vk: u32) -> Option<(u8, u8)> {
    routes.get(&(recent, vk)).or_else(|| if held != recent { routes.get(&(held, vk)) } else { None }).copied()
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        if info.flags & LLKHF_INJECTED == 0 && !paused() {
            if let Some(hook) = HOOK.get() {
                if let Some(result) = handle_key(hook, info, matches!(wparam as u32, WM_KEYDOWN | WM_SYSKEYDOWN)) {
                    return result;
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

fn handle_key(hook: &Hook, info: &KBDLLHOOKSTRUCT, down: bool) -> Option<LRESULT> {
    let mut keys = hook.keys.lock().unwrap();
    if let Some((key, _)) = MODIFIER_BITS.iter().find(|(key, _)| *key as u32 == info.vkCode) {
        if down {
            keys.modifiers_down.entry(*key).or_insert(info.time);
        } else {
            keys.modifiers_down.remove(key);
        }
        return None;
    }
    if !(VK_F13..=VK_F24).contains(&info.vkCode) {
        return None;
    }
    if !down {
        let (route, _) = keys.held.remove(&info.vkCode)?;
        drop(keys);
        (hook.fired)(route.0, route.1, false);
        return Some(1);
    }
    // A repetição automática do Windows não dispara a ação de novo.
    if let Some((_, last)) = keys.held.get_mut(&info.vkCode) {
        if info.time.wrapping_sub(*last) < STUCK_MS {
            *last = info.time;
            return Some(1);
        }
    }
    let recent = recent_modifiers(&keys, info.time);
    let route = find_route(&hook.routes.read().unwrap(), recent, held_modifiers(), info.vkCode)?;
    keys.held.insert(info.vkCode, (route, info.time));
    drop(keys);
    (hook.fired)(route.0, route.1, true);
    Some(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route_table() -> HashMap<(u8, u32), (u8, u8)> {
        HashMap::from([((0, VK_F13), (1, 1)), ((0x02, VK_F13), (1, 16))])
    }

    #[test]
    fn modificador_segurado_no_teclado_nao_troca_a_rota() {
        // Shift segurado no teclado (não é recente) e o macropad envia F13 puro.
        assert_eq!(find_route(&route_table(), 0, 0x02, VK_F13), Some((1, 1)));
    }

    #[test]
    fn modificador_do_proprio_macropad_escolhe_a_rota() {
        assert_eq!(find_route(&route_table(), 0x02, 0x02, VK_F13), Some((1, 16)));
    }

    #[test]
    fn modificador_recente_conta_so_dentro_da_janela() {
        let mut keys = Keys::default();
        keys.modifiers_down.insert(VK_LSHIFT, 1000);
        assert_eq!(recent_modifiers(&keys, 1020), 0x02);
        assert_eq!(recent_modifiers(&keys, 2000), 0);
    }
}
