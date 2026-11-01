// Teclas virtuais: o macropad envia F13–F24 (às vezes com Ctrl/Shift). Este gancho de
// teclado de baixo nível as reconhece antes dos outros programas, impede que cheguem a
// eles e avisa o executor qual (camada, slot) foi acionado.
use crate::config::Macro;
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock, RwLock},
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

type Fired = Box<dyn Fn(u8, u8) + Send + Sync>;

struct Hook {
    routes: RwLock<HashMap<(u8, u32), (u8, u8)>>,
    held: Mutex<HashSet<u32>>,
    fired: Fired,
}

static HOOK: OnceLock<Hook> = OnceLock::new();

// Modificadores no formato de bits HID usado pelo firmware.
pub fn held_modifiers() -> u8 {
    let down = |key: u16| unsafe { GetAsyncKeyState(key as i32) } < 0;
    (down(VK_LCONTROL) as u8) | (down(VK_LSHIFT) as u8) << 1 | (down(VK_RCONTROL) as u8) << 4 | (down(VK_RSHIFT) as u8) << 5
}

pub fn start(fired: impl Fn(u8, u8) + Send + Sync + 'static) {
    let hook = Hook { routes: RwLock::default(), held: Mutex::default(), fired: Box::new(fired) };
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

pub fn set_routes(macros: &[Macro]) {
    let Some(hook) = HOOK.get() else { return };
    let routes = macros
        .iter()
        .filter(|item| (HID_F13..=HID_F24).contains(&item.code))
        .map(|item| ((item.mods, VK_F13 + (item.code - HID_F13) as u32), (item.layer, item.slot)))
        .collect();
    *hook.routes.write().unwrap() = routes;
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        if (VK_F13..=VK_F24).contains(&info.vkCode) && info.flags & LLKHF_INJECTED == 0 {
            if let Some(hook) = HOOK.get() {
                let mut held = hook.held.lock().unwrap();
                let down = matches!(wparam as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
                if down {
                    let route = hook.routes.read().unwrap().get(&(held_modifiers(), info.vkCode)).copied();
                    if let Some((layer, slot)) = route {
                        // A repetição automática do Windows não dispara a ação de novo.
                        if held.insert(info.vkCode) {
                            (hook.fired)(layer, slot);
                        }
                        return 1;
                    }
                } else if held.remove(&info.vkCode) {
                    return 1;
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}
