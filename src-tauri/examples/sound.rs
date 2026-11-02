// Diagnóstico do "Tocar som": abre o arquivo pelo MCI como o app faz e mostra o erro, se houver.
//
//   cargo run --example sound -- "C:\Users\Lune\Downloads\faaa2h.mp3" [tipo]
//
// "tipo" é o dispositivo MCI (padrão: mpegvideo); com "auto" o MCI escolhe pela extensão.
use std::{ptr::null_mut, thread};
use windows_sys::Win32::Media::Multimedia::{mciGetErrorStringW, mciSendStringW};

fn command(text: &str) -> Result<String, String> {
    let wide: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    let mut reply = [0u16; 256];
    let code = unsafe { mciSendStringW(wide.as_ptr(), reply.as_mut_ptr(), reply.len() as u32, null_mut()) };
    if code == 0 {
        let length = reply.iter().position(|&unit| unit == 0).unwrap_or(0);
        return Ok(String::from_utf16_lossy(&reply[..length]));
    }
    let mut message = [0u16; 256];
    unsafe { mciGetErrorStringW(code, message.as_mut_ptr(), message.len() as u32) };
    let length = message.iter().position(|&unit| unit == 0).unwrap_or(0);
    Err(format!("erro {code}: {}", String::from_utf16_lossy(&message[..length])))
}

fn main() {
    let path = std::env::args().nth(1).expect("informe o arquivo");
    let kind = std::env::args().nth(2).unwrap_or_else(|| "mpegvideo".into());
    // Numa thread nova, sem COM inicializado: igual ao app.
    thread::spawn(move || {
        let open = if kind == "auto" { format!("open \"{path}\" alias teste") } else { format!("open \"{path}\" type {kind} alias teste") };
        println!("{open}");
        match command(&open) {
            Err(error) => return println!("  open falhou, {error}"),
            Ok(_) => println!("  open ok"),
        }
        println!("  duração: {:?} ms", command("status teste length"));
        println!("  play: {:?}", command("play teste wait"));
        println!("  close: {:?}", command("close teste"));
    })
    .join()
    .unwrap();
}
