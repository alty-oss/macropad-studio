// Integrações sem estado próprio: requisições HTTP (webhooks) e a Remote API do Voicemeeter.
use std::{
    ffi::{c_char, c_void, CString},
    mem::transmute,
    sync::OnceLock,
    time::Duration,
};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

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

}
