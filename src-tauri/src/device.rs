// Transporte HID. O protocolo continua no JavaScript; aqui só abrimos a interface de
// configuração (página 0xFF00) e trocamos relatórios de 64 bytes.
use hidapi::{DeviceInfo, HidApi, HidDevice};
use std::{
    thread,
    time::{Duration, Instant},
};

const VENDOR_ID: u16 = 0x1189;
const PRODUCT_ID: u16 = 0x8840;
const USAGE_PAGE: u16 = 0xff00;
const USAGE: u16 = 1;
const REPORT_ID: u8 = 3;
const REPORT_LENGTH: usize = 64;
pub const NOT_FOUND: &str = "Macropad não encontrado.";

pub struct Hid {
    api: Option<HidApi>,
    device: Option<HidDevice>,
}

fn is_configuration_interface(info: &DeviceInfo) -> bool {
    info.vendor_id() == VENDOR_ID
        && info.product_id() == PRODUCT_ID
        && info.usage_page() == USAGE_PAGE
        && info.usage() == USAGE
}

impl Hid {
    pub fn new() -> Self {
        Self { api: HidApi::new().ok(), device: None }
    }

    fn api(&mut self) -> Result<&mut HidApi, String> {
        if self.api.is_none() {
            self.api = Some(HidApi::new().map_err(|e| e.to_string())?);
        }
        Ok(self.api.as_mut().unwrap())
    }

    // Atualiza a lista de dispositivos e fecha a conexão se o macropad saiu.
    pub fn present(&mut self) -> bool {
        let present = match self.api() {
            Ok(api) => api.refresh_devices().is_ok() && api.device_list().any(is_configuration_interface),
            Err(_) => false,
        };
        if !present {
            self.device = None;
        }
        present
    }

    pub fn open(&mut self) -> Result<(), String> {
        if self.device.is_some() {
            return Ok(());
        }
        let api = self.api()?;
        api.refresh_devices().map_err(|e| e.to_string())?;
        let info = api.device_list().find(|info| is_configuration_interface(info)).ok_or(NOT_FOUND)?;
        let device = info.open_device(api).map_err(|e| format!("Não foi possível abrir o macropad: {e}"))?;
        self.device = Some(device);
        Ok(())
    }

    fn device(&self) -> Result<&HidDevice, String> {
        self.device.as_ref().ok_or_else(|| NOT_FOUND.to_string())
    }

    // Uma falha de E/S quase sempre significa cabo removido: descartamos o handle.
    fn checked<T>(&mut self, result: Result<T, String>) -> Result<T, String> {
        if result.is_err() {
            self.device = None;
        }
        result
    }

    pub fn send(&mut self, payload: &[u8]) -> Result<(), String> {
        let result = self.device().and_then(|device| write(device, payload));
        self.checked(result)
    }

    pub fn ask(&mut self, payload: &[u8], expected: usize, timeout: Duration) -> Result<Vec<Vec<u8>>, String> {
        let result = self.device().and_then(|device| ask(device, payload, expected, timeout));
        self.checked(result)
    }
}

fn write(device: &HidDevice, payload: &[u8]) -> Result<(), String> {
    if payload.len() > REPORT_LENGTH {
        return Err("Relatório maior que 64 bytes.".into());
    }
    let mut report = [0u8; REPORT_LENGTH + 1];
    report[0] = REPORT_ID;
    report[1..=payload.len()].copy_from_slice(payload);
    device.write(&report).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(8));
    Ok(())
}

fn ask(device: &HidDevice, payload: &[u8], expected: usize, timeout: Duration) -> Result<Vec<Vec<u8>>, String> {
    let mut buffer = [0u8; REPORT_LENGTH + 1];
    // Descarta relatórios antigos para não misturá-los com as respostas desta pergunta.
    while device.read_timeout(&mut buffer, 0).map_err(|e| e.to_string())? > 0 {}
    write(device, payload)?;
    let deadline = Instant::now() + timeout;
    let mut replies = Vec::new();
    while replies.len() < expected {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        let read = device.read_timeout(&mut buffer, left.as_millis() as i32).map_err(|e| e.to_string())?;
        // No Windows, o primeiro byte é o ID do relatório; o WebHID já o removia.
        if read > 1 {
            replies.push(buffer[1..read].to_vec());
        }
    }
    Ok(replies)
}
