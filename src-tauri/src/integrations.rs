// Integrações sem estado próprio: requisições HTTP (webhooks), Home Assistant, saída MIDI e a
// Remote API do Voicemeeter.
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::{c_char, c_void, CString},
    mem::{size_of, transmute},
    ptr::null_mut,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use windows_sys::Win32::{
    Media::Audio::{
        midiOutClose, midiOutGetDevCapsW, midiOutGetNumDevs, midiOutOpen, midiOutShortMsg, CALLBACK_NULL, HMIDIOUT,
        MIDIOUTCAPSW,
    },
    System::LibraryLoader::{GetProcAddress, LoadLibraryW},
};

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build()
}

fn failure(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, response) => {
            let detail = response.into_string().unwrap_or_default();
            let detail = detail.trim();
            if detail.is_empty() || detail.len() > 160 { format!("O servidor respondeu {code}.") } else { format!("O servidor respondeu {code}: {detail}") }
        }
        ureq::Error::Transport(transport) => format!("Sem resposta do servidor: {transport}"),
    }
}

// Cabeçalhos no formato "Nome: valor", um por linha.
pub fn parse_headers(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_string(), value.trim().to_string()))
        .filter(|(name, _)| !name.is_empty())
        .collect()
}

pub fn http(method: &str, url: &str, headers: &str, body: &str) -> Result<String, String> {
    let mut request = agent().request(&method.to_uppercase(), url.trim());
    let headers = parse_headers(headers);
    for (name, value) in &headers {
        request = request.set(name, value);
    }
    // Corpo que parece JSON vai como JSON, a menos que o usuário tenha escolhido outro tipo.
    let trimmed = body.trim();
    if (trimmed.starts_with('{') || trimmed.starts_with('[')) && !headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("content-type")) {
        request = request.set("Content-Type", "application/json");
    }
    let response = if body.is_empty() { request.call() } else { request.send_string(body) };
    response.map(|response| format!("HTTP {}", response.status())).map_err(failure)
}

fn home_assistant_url(base: &str, path: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Configure o endereço do Home Assistant nas Configurações.".into());
    }
    Ok(format!("{base}{path}"))
}

// Chama homeassistant.<service> (turn_on, turn_off, toggle), que vale para luzes, tomadas, cenas e scripts.
pub fn home_assistant(base: &str, token: &str, service: &str, entity: &str) -> Result<String, String> {
    let url = home_assistant_url(base, &format!("/api/services/homeassistant/{service}"))?;
    agent()
        .post(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .send_json(serde_json::json!({ "entity_id": entity }))
        .map(|_| entity.to_string())
        .map_err(failure)
}

#[derive(Serialize)]
pub struct Entity {
    pub id: String,
    pub name: String,
}

pub fn home_assistant_entities(base: &str, token: &str) -> Result<Vec<Entity>, String> {
    let url = home_assistant_url(base, "/api/states")?;
    let states: serde_json::Value = agent()
        .get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .map_err(failure)?
        .into_json()
        .map_err(|e| e.to_string())?;
    let mut entities: Vec<Entity> = states
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|state| {
            let id = state["entity_id"].as_str()?.to_string();
            let name = state["attributes"]["friendly_name"].as_str().unwrap_or(&id).to_string();
            Some(Entity { id, name })
        })
        .collect();
    entities.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entities)
}

pub fn midi_ports() -> Vec<String> {
    (0..unsafe { midiOutGetNumDevs() })
        .filter_map(|id| unsafe {
            let mut caps: MIDIOUTCAPSW = std::mem::zeroed();
            (midiOutGetDevCapsW(id as usize, &mut caps, size_of::<MIDIOUTCAPSW>() as u32) == 0).then(|| {
                // A estrutura é compactada: copiamos o nome antes de ler.
                let name = caps.szPname;
                let length = name.iter().position(|&unit| unit == 0).unwrap_or(name.len());
                String::from_utf16_lossy(&name[..length])
            })
        })
        .collect()
}

// Último valor enviado em cada (porta, canal, controle), para o modo "somar" dos knobs.
type MidiValues = HashMap<(String, u8, u8), i32>;
static MIDI_VALUES: OnceLock<Mutex<MidiValues>> = OnceLock::new();

pub fn midi_value(previous: i32, mode: &str, value: i32) -> i32 {
    if mode == "add" { (previous + value).clamp(0, 127) } else { value.clamp(0, 127) }
}

pub fn midi(port: &str, channel: u8, control: u8, mode: &str, value: i32) -> Result<String, String> {
    let id = midi_ports().iter().position(|name| name == port).ok_or_else(|| format!("Porta MIDI não encontrada: {port}."))?;
    let values = MIDI_VALUES.get_or_init(Mutex::default);
    let key = (port.to_string(), channel, control);
    let next = {
        let mut values = values.lock().unwrap();
        let next = midi_value(*values.get(&key).unwrap_or(&64), mode, value);
        values.insert(key, next);
        next
    };
    let status = 0xb0 | (channel.clamp(1, 16) - 1) as u32;
    let message = status | (control.min(127) as u32) << 8 | (next as u32) << 16;
    unsafe {
        let mut handle: HMIDIOUT = null_mut();
        if midiOutOpen(&mut handle, id as u32, 0, 0, CALLBACK_NULL) != 0 {
            return Err(format!("A porta MIDI {port} está ocupada ou indisponível."));
        }
        let result = midiOutShortMsg(handle, message);
        midiOutClose(handle);
        if result != 0 {
            return Err("Falha ao enviar a mensagem MIDI.".into());
        }
    }
    Ok(format!("CC {control} · {next}"))
}

type Login = unsafe extern "system" fn() -> i32;
type Dirty = unsafe extern "system" fn() -> i32;
type GetFloat = unsafe extern "system" fn(*const c_char, *mut f32) -> i32;
type SetFloat = unsafe extern "system" fn(*const c_char, f32) -> i32;

struct Voicemeeter {
    dirty: Dirty,
    get: GetFloat,
    set: SetFloat,
}

static VOICEMEETER: OnceLock<Result<Voicemeeter, String>> = OnceLock::new();

fn voicemeeter_api() -> Result<&'static Voicemeeter, String> {
    VOICEMEETER
        .get_or_init(|| unsafe {
            let folders = [r"C:\Program Files (x86)\VB\Voicemeeter", r"C:\Program Files\VB\Voicemeeter"];
            let library = folders
                .iter()
                .map(|folder| LoadLibraryW(crate::system::wide(&format!(r"{folder}\VoicemeeterRemote64.dll")).as_ptr()))
                .find(|library| !library.is_null())
                .ok_or("Voicemeeter não encontrado. Instale o Voicemeeter para usar esta etapa.")?;
            let function = |name: &str| -> Result<*const c_void, String> {
                let name = CString::new(name).unwrap();
                GetProcAddress(library, name.as_ptr() as *const u8).map(|f| f as *const c_void).ok_or_else(|| "DLL do Voicemeeter incompatível.".to_string())
            };
            let login: Login = transmute(function("VBVMR_Login")?);
            let api = Voicemeeter {
                dirty: transmute::<*const c_void, Dirty>(function("VBVMR_IsParametersDirty")?),
                get: transmute::<*const c_void, GetFloat>(function("VBVMR_GetParameterFloat")?),
                set: transmute::<*const c_void, SetFloat>(function("VBVMR_SetParameterFloat")?),
            };
            if login() < 0 {
                return Err("Não foi possível conectar ao Voicemeeter.".into());
            }
            Ok(api)
        })
        .as_ref()
        .map_err(Clone::clone)
}

// Parâmetros como "Strip[0].Gain" ou "Bus[1].Mute". "add" soma ao valor atual; "toggle" alterna 0 e 1.
pub fn voicemeeter(parameter: &str, mode: &str, value: f64) -> Result<String, String> {
    let api = voicemeeter_api()?;
    let name = CString::new(parameter.trim()).map_err(|_| "Nome de parâmetro inválido.")?;
    unsafe {
        (api.dirty)();
        let mut current = 0f32;
        if mode != "set" && (api.get)(name.as_ptr(), &mut current) != 0 {
            return Err(format!("O Voicemeeter não reconheceu o parâmetro {parameter} (ele está aberto?)."));
        }
        let next = match mode {
            "add" => current + value as f32,
            "toggle" => if current >= 0.5 { 0.0 } else { 1.0 },
            _ => value as f32,
        };
        if (api.set)(name.as_ptr(), next) != 0 {
            return Err(format!("O Voicemeeter recusou o parâmetro {parameter}."));
        }
        Ok(format!("{parameter} · {}", (next * 10.0).round() / 10.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cabecalhos_um_por_linha() {
        let headers = parse_headers("Authorization: Bearer abc\n\nX-Teste:1\nsem dois pontos");
        assert_eq!(headers, vec![("Authorization".into(), "Bearer abc".into()), ("X-Teste".into(), "1".into())]);
    }

    #[test]
    fn midi_soma_dentro_de_0_a_127() {
        assert_eq!(midi_value(120, "add", 10), 127);
        assert_eq!(midi_value(5, "add", -10), 0);
        assert_eq!(midi_value(5, "set", 200), 127);
    }
}
