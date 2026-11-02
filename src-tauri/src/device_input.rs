// O que o macropad envia como teclado e controle de mídia, pelo Raw Input. Além de alimentar a
// pré-visualização, as teclas que correspondem a ações do app são encaminhadas ao executor.
//
// O Raw Input entrega as teclas de todos os teclados; só as do macropad (USB 1189:8840) são lidas,
// as demais são descartadas na hora. O macropad deste modelo não gera mensagens legadas (o teste
// do gancho confirmou isso), então não usamos NOLEGACY, que seria global para todos os teclados.
//
// Formato confirmado no aparelho (cargo run --example probe):
// - teclado (coleção 1 da interface 1): uma tecla por evento, com keydown repetido pelo Windows
//   enquanto a tecla está pressionada e keyup ao soltar; um clique do knob vem como keydown e keyup
//   em ~5 ms;
// - mídia (coleção 4): relatório 0x05 com o uso de 16 bits (0xEA volume −, 0xE9 volume +,
//   0xE2 mudo…) e um relatório zerado ao soltar.
use crate::executor::hid_from_scan;
use serde::Serialize;
use std::{
    collections::HashMap,
    mem::size_of,
    ptr::{null, null_mut},
    thread,
};
use windows_sys::Win32::UI::{
    Input::{
        GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_DEVICENAME, RID_INPUT, RIM_TYPEHID, RIM_TYPEKEYBOARD,
    },
    WindowsAndMessaging::{CreateWindowExW, DispatchMessageW, GetMessageW, HWND_MESSAGE, MSG, WM_INPUT},
};

const DEVICE: &str = "VID_1189&PID_8840";
const RI_KEY_BREAK: u16 = 1;
const RI_KEY_E0: u16 = 2;
const RI_KEY_E1: u16 = 4;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum DeviceInput {
    // Uma combinação nova: modificadores no formato HID do firmware e o uso HID da tecla.
    Key { mods: u8, code: u8, down: bool },
    // Um uso de mídia (página 0x0C) pressionado.
    Media { media: u16 },
}

#[derive(Default)]
struct Reader {
    // Handle do dispositivo → é o macropad?
    devices: HashMap<isize, bool>,
    mods: u8,
    held: HashMap<u8, u8>,
    media: u16,
}

// Bit HID de um modificador, pelo scancode e pela marca E0 (lado direito).
fn modifier_bit(scan: u16, e0: bool) -> Option<u8> {
    match (scan, e0) {
        (0x1d, false) => Some(0x01),
        (0x2a, false) => Some(0x02),
        (0x38, false) => Some(0x04),
        (0x5b, true) => Some(0x08),
        (0x1d, true) => Some(0x10),
        (0x36, false) => Some(0x20),
        (0x38, true) => Some(0x40),
        (0x5c, true) => Some(0x80),
        _ => None,
    }
}

impl Reader {
    // Um evento de teclado do macropad. Devolve a combinação só na primeira descida da tecla.
    fn key(&mut self, scan: u16, flags: u16) -> Option<DeviceInput> {
        if flags & RI_KEY_E1 != 0 {
            return None;
        }
        let (e0, up) = (flags & RI_KEY_E0 != 0, flags & RI_KEY_BREAK != 0);
        if let Some(bit) = modifier_bit(scan, e0) {
            if up { self.mods &= !bit } else { self.mods |= bit }
            return None;
        }
        let code = hid_from_scan(scan, e0)?;
        if up {
            return self.held.remove(&code).map(|mods| DeviceInput::Key { mods, code, down: false });
        }
        // A repetição automática do Windows não conta como nova pressão.
        if self.held.insert(code, self.mods).is_none() {
            Some(DeviceInput::Key { mods: self.mods, code, down: true })
        } else {
            None
        }
    }

    // Um relatório do controle de mídia: [ID, uso (16 bits, little-endian)].
    fn media(&mut self, report: &[u8]) -> Option<DeviceInput> {
        let usage = match report {
            [_, low, high, ..] => u16::from_le_bytes([*low, *high]),
            [_, low] => *low as u16,
            _ => return None,
        };
        let previous = std::mem::replace(&mut self.media, usage);
        (usage != 0 && usage != previous).then_some(DeviceInput::Media { media: usage })
    }
}

fn is_macropad(device: isize) -> bool {
    unsafe {
        let mut size = 0u32;
        GetRawInputDeviceInfoW(device as _, RIDI_DEVICENAME, null_mut(), &mut size);
        let mut name = vec![0u16; size as usize];
        GetRawInputDeviceInfoW(device as _, RIDI_DEVICENAME, name.as_mut_ptr() as _, &mut size);
        String::from_utf16_lossy(&name).to_uppercase().contains(DEVICE)
    }
}

pub fn start(on_input: impl Fn(DeviceInput) + Send + 'static) {
    thread::spawn(move || unsafe {
        // Janela só de mensagens: recebe o Raw Input mesmo com outra janela em foco (INPUTSINK).
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window = CreateWindowExW(0, class.as_ptr(), null(), 0, 0, 0, 0, 0, HWND_MESSAGE, null_mut(), null_mut(), null());
        if window.is_null() {
            eprintln!("Não foi possível criar a janela do Raw Input.");
            return;
        }
        let devices = [
            RAWINPUTDEVICE { usUsagePage: 1, usUsage: 6, dwFlags: RIDEV_INPUTSINK, hwndTarget: window },
            RAWINPUTDEVICE { usUsagePage: 0x0c, usUsage: 1, dwFlags: RIDEV_INPUTSINK, hwndTarget: window },
        ];
        if RegisterRawInputDevices(devices.as_ptr(), devices.len() as u32, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            eprintln!("Não foi possível registrar o Raw Input.");
            return;
        }
        let mut reader = Reader::default();
        let mut message: MSG = std::mem::zeroed();
        let header = size_of::<RAWINPUTHEADER>() as u32;
        while GetMessageW(&mut message, null_mut(), 0, 0) > 0 {
            if message.message != WM_INPUT {
                DispatchMessageW(&message);
                continue;
            }
            let mut size = 0u32;
            GetRawInputData(message.lParam as HRAWINPUT, RID_INPUT, null_mut(), &mut size, header);
            let mut buffer = vec![0u8; size as usize];
            if GetRawInputData(message.lParam as HRAWINPUT, RID_INPUT, buffer.as_mut_ptr() as _, &mut size, header) != size {
                continue;
            }
            // O WM_INPUT precisa seguir para o DefWindowProc, que libera o buffer do sistema.
            DispatchMessageW(&message);
            let input = &*(buffer.as_ptr() as *const RAWINPUT);
            let device = input.header.hDevice as isize;
            if !*reader.devices.entry(device).or_insert_with(|| is_macropad(device)) {
                continue;
            }
            match input.header.dwType {
                RIM_TYPEKEYBOARD => {
                    if let Some(event) = reader.key(input.data.keyboard.MakeCode, input.data.keyboard.Flags) {
                        on_input(event);
                    }
                }
                RIM_TYPEHID => {
                    // Um WM_INPUT pode trazer vários relatórios seguidos.
                    let hid = input.data.hid;
                    let all = std::slice::from_raw_parts(hid.bRawData.as_ptr(), (hid.dwSizeHid * hid.dwCount) as usize);
                    for report in all.chunks(hid.dwSizeHid.max(1) as usize) {
                        if let Some(event) = reader.media(report) {
                            on_input(event);
                        }
                    }
                }
                _ => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clique_do_knob_vira_uma_tecla() {
        // Knob 1 do aparelho de teste: girar à esquerda envia "1" (scancode 0x02).
        let mut reader = Reader::default();
        assert_eq!(reader.key(0x02, 0), Some(DeviceInput::Key { mods: 0, code: 0x1e, down: true }));
        assert_eq!(reader.key(0x02, RI_KEY_BREAK), Some(DeviceInput::Key { mods: 0, code: 0x1e, down: false }));
        assert_eq!(reader.key(0x02, 0), Some(DeviceInput::Key { mods: 0, code: 0x1e, down: true }));
    }

    #[test]
    fn tecla_segurada_conta_uma_vez() {
        let mut reader = Reader::default();
        assert_eq!(reader.key(0x3b, 0), Some(DeviceInput::Key { mods: 0, code: 0x3a, down: true }));
        assert_eq!(reader.key(0x3b, 0), None);
        assert_eq!(reader.key(0x3b, 0), None);
        reader.key(0x3b, RI_KEY_BREAK);
        assert!(reader.key(0x3b, 0).is_some());
    }

    #[test]
    fn modificadores_do_macropad_entram_na_combinacao() {
        let mut reader = Reader::default();
        reader.key(0x1d, 0);
        reader.key(0x2a, 0);
        assert_eq!(reader.key(0x2c, 0), Some(DeviceInput::Key { mods: 0x03, code: 0x1d, down: true }));
        reader.key(0x1d, RI_KEY_BREAK);
        reader.key(0x2a, RI_KEY_BREAK);
        reader.key(0x2c, RI_KEY_BREAK);
        assert_eq!(reader.key(0x1d, RI_KEY_E0), None);
        assert_eq!(reader.key(0x48, RI_KEY_E0), Some(DeviceInput::Key { mods: 0x10, code: 0x52, down: true }));
    }

    #[test]
    fn midia_como_capturada_no_aparelho() {
        let mut reader = Reader::default();
        assert_eq!(reader.media(&[0x05, 0xea, 0x00]), Some(DeviceInput::Media { media: 0xea }));
        assert_eq!(reader.media(&[0x05, 0x00, 0x00]), None);
        assert_eq!(reader.media(&[0x05, 0xea, 0x00]), Some(DeviceInput::Media { media: 0xea }));
        assert_eq!(reader.media(&[0x05, 0xe9, 0x00]), Some(DeviceInput::Media { media: 0xe9 }));
    }
}
