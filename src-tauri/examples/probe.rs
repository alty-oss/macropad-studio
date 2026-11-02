// Diagnóstico: mostra tudo o que o macropad (USB 1189:8840) envia ao Windows pelas interfaces de
// entrada (teclado, mouse e controle de consumidor), com Raw Input. Não envia nada ao aparelho.
//
//   cargo run --example probe -- 30      (escuta por 30 segundos)
//   cargo run --example probe -- 10 all  (todos os dispositivos, para testar a ferramenta)
use std::{
    mem::size_of,
    ptr::{null, null_mut},
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::HWND,
    UI::{
        Input::{
            GetRawInputData, GetRawInputDeviceInfoW, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
            RAWINPUTHEADER, RIDEV_INPUTSINK, RIDI_DEVICENAME, RID_INPUT, RIM_TYPEHID, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
        },
        WindowsAndMessaging::{CreateWindowExW, PeekMessageW, HWND_MESSAGE, MSG, PM_REMOVE, WM_INPUT},
    },
};

fn device_name(device: isize) -> String {
    unsafe {
        let mut size = 0u32;
        GetRawInputDeviceInfoW(device as _, RIDI_DEVICENAME, null_mut(), &mut size);
        let mut name = vec![0u16; size as usize];
        GetRawInputDeviceInfoW(device as _, RIDI_DEVICENAME, name.as_mut_ptr() as _, &mut size);
        String::from_utf16_lossy(&name).trim_end_matches('\0').to_string()
    }
}

fn main() {
    let seconds: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(30);
    // "all" mostra todos os dispositivos, para testar a própria ferramenta.
    let all = std::env::args().any(|arg| arg == "all");
    unsafe {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let window: HWND = CreateWindowExW(0, class.as_ptr(), null(), 0, 0, 0, 0, 0, HWND_MESSAGE, null_mut(), null_mut(), null());
        // Teclado (1/6), mouse (1/2) e controle de consumidor (0x0C/1), mesmo com outra janela em foco.
        let devices = [(1u16, 6u16), (1, 2), (0x0c, 1)].map(|(page, usage)| RAWINPUTDEVICE { usUsagePage: page, usUsage: usage, dwFlags: RIDEV_INPUTSINK, hwndTarget: window });
        if RegisterRawInputDevices(devices.as_ptr(), devices.len() as u32, size_of::<RAWINPUTDEVICE>() as u32) == 0 {
            eprintln!("Não foi possível registrar o Raw Input.");
            return;
        }
        println!("Escutando o macropad por {seconds} s. Gire e pressione os knobs e as teclas.");
        let started = Instant::now();
        let mut message: MSG = std::mem::zeroed();
        while started.elapsed() < Duration::from_secs(seconds) {
            if PeekMessageW(&mut message, null_mut(), 0, 0, PM_REMOVE) == 0 {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            if message.message != WM_INPUT {
                continue;
            }
            let mut size = 0u32;
            let header = size_of::<RAWINPUTHEADER>() as u32;
            GetRawInputData(message.lParam as HRAWINPUT, RID_INPUT, null_mut(), &mut size, header);
            let mut buffer = vec![0u8; size as usize];
            GetRawInputData(message.lParam as HRAWINPUT, RID_INPUT, buffer.as_mut_ptr() as _, &mut size, header);
            let input = &*(buffer.as_ptr() as *const RAWINPUT);
            let name = device_name(input.header.hDevice as isize);
            if !all && !name.to_uppercase().contains("VID_1189&PID_8840") {
                continue;
            }
            let collection = name.to_uppercase().split('&').find(|part| part.starts_with("COL")).unwrap_or("?").to_string();
            let t = started.elapsed().as_millis();
            match input.header.dwType {
                RIM_TYPEKEYBOARD => {
                    let k = input.data.keyboard;
                    println!("{t:>6} ms  {collection} teclado  vk=0x{:02x} scan=0x{:02x} flags={} ({})", k.VKey, k.MakeCode, k.Flags, if k.Flags & 1 == 0 { "desce" } else { "sobe" });
                }
                RIM_TYPEMOUSE => {
                    let m = input.data.mouse;
                    println!("{t:>6} ms  {collection} mouse    botões=0x{:04x} dados={} dx={} dy={}", m.Anonymous.Anonymous.usButtonFlags, m.Anonymous.Anonymous.usButtonData as i16, m.lLastX, m.lLastY);
                }
                RIM_TYPEHID => {
                    let hid = input.data.hid;
                    let bytes = std::slice::from_raw_parts(hid.bRawData.as_ptr(), (hid.dwSizeHid * hid.dwCount) as usize);
                    let hex: Vec<String> = bytes.iter().map(|b| format!("{b:02x}")).collect();
                    println!("{t:>6} ms  {collection} hid      {}", hex.join(" "));
                }
                _ => {}
            }
        }
        println!("Fim.");
    }
}
