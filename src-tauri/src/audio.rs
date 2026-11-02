// Áudio do Windows: mudo e volume do microfone e da saída padrão (Core Audio), volume por
// programa (sessões de áudio) e se há mídia tocando (SMTC), para o estado da tecla tocar/pausar.
// Cada função devolve um texto curto para o OSD, como "Microfone mudo" ou "Spotify · 40%".
use crate::system::process_name;
use windows::{
    core::{Interface, GUID},
    Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager},
    Win32::{
        Foundation::BOOL,
        Media::Audio::{
            eCapture, eConsole, eRender, EDataFlow, Endpoints::IAudioEndpointVolume, IAudioSessionControl2,
            IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
        },
        System::Com::{CoCreateInstance, CLSCTX_ALL},
    },
};

fn text(error: windows::core::Error) -> String {
    error.message().to_string()
}

fn default_device(flow: EDataFlow) -> windows::core::Result<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerator.GetDefaultAudioEndpoint(flow, eConsole)
    }
}

// Novo nível de volume (0 a 1) depois de "up" ou "down" em passos de "amount" por cento.
fn stepped(current: f32, action: &str, amount: u8) -> f32 {
    let delta = amount as f32 / 100.0;
    match action {
        "up" => (current + delta).min(1.0),
        "down" => (current - delta).max(0.0),
        _ => current,
    }
}

// Novo estado de mudo para "toggle", "mute" ou "unmute".
fn muted(current: bool, action: &str) -> Option<bool> {
    match action {
        "toggle" => Some(!current),
        "mute" => Some(true),
        "unmute" => Some(false),
        _ => None,
    }
}

fn endpoint(flow: EDataFlow, name: &str, action: &str, amount: u8) -> windows::core::Result<String> {
    unsafe {
        let volume: IAudioEndpointVolume = default_device(flow)?.Activate(CLSCTX_ALL, None)?;
        if let Some(mute) = muted(volume.GetMute()?.as_bool(), action) {
            volume.SetMute(BOOL::from(mute), &GUID::zeroed())?;
            return Ok(format!("{name} {}", if mute { "mudo" } else { "ativado" }));
        }
        let level = stepped(volume.GetMasterVolumeLevelScalar()?, action, amount);
        volume.SetMasterVolumeLevelScalar(level, &GUID::zeroed())?;
        Ok(format!("{name} · {}%", (level * 100.0).round()))
    }
}

fn application(app: &str, action: &str, amount: u8) -> windows::core::Result<Option<String>> {
    let wanted = app.trim().to_lowercase();
    let mut result = None;
    unsafe {
        let manager: IAudioSessionManager2 = default_device(eRender)?.Activate(CLSCTX_ALL, None)?;
        let sessions = manager.GetSessionEnumerator()?;
        // Um programa pode ter várias sessões (abas do navegador, por exemplo): todas mudam juntas.
        for index in 0..sessions.GetCount()? {
            let control = sessions.GetSession(index)?;
            let Ok(control2) = control.cast::<IAudioSessionControl2>() else { continue };
            let Ok(pid) = control2.GetProcessId() else { continue };
            if process_name(pid).is_none_or(|name| name != wanted) {
                continue;
            }
            let volume: ISimpleAudioVolume = control.cast()?;
            if let Some(mute) = muted(volume.GetMute()?.as_bool(), action) {
                volume.SetMute(BOOL::from(mute), &GUID::zeroed())?;
                result = Some(format!("{app} {}", if mute { "mudo" } else { "ativado" }));
            } else {
                let level = stepped(volume.GetMasterVolume()?, action, amount);
                volume.SetMasterVolume(level, &GUID::zeroed())?;
                result = Some(format!("{app} · {}%", (level * 100.0).round()));
            }
        }
    }
    Ok(result)
}

pub fn run(target: &str, app: &str, action: &str, amount: u8) -> Result<String, String> {
    match target {
        "mic" => endpoint(eCapture, "Microfone", action, amount).map_err(text),
        "output" => endpoint(eRender, "Som", action, amount).map_err(text),
        "app" => application(app, action, amount)
            .map_err(text)?
            .ok_or_else(|| format!("{app} não está tocando som agora.")),
        _ => Err(format!("Destino de áudio desconhecido: {target}.")),
    }
}

// Mudo atual de um destino ("mic", "output" ou "app"), para o estado dos botões do celular. None
// quando não dá para saber (sem dispositivo, programa sem som).
pub fn muted_state(target: &str, app: &str) -> Option<bool> {
    unsafe {
        match target {
            "mic" | "output" => {
                let volume: IAudioEndpointVolume = default_device(if target == "mic" { eCapture } else { eRender }).ok()?.Activate(CLSCTX_ALL, None).ok()?;
                volume.GetMute().ok().map(|mute| mute.as_bool())
            }
            "app" => {
                let wanted = app.trim().to_lowercase();
                let manager: IAudioSessionManager2 = default_device(eRender).ok()?.Activate(CLSCTX_ALL, None).ok()?;
                let sessions = manager.GetSessionEnumerator().ok()?;
                for index in 0..sessions.GetCount().ok()? {
                    let Ok(control) = sessions.GetSession(index) else { continue };
                    let Some(pid) = control.cast::<IAudioSessionControl2>().ok().and_then(|control| control.GetProcessId().ok()) else { continue };
                    if process_name(pid).is_some_and(|name| name == wanted) {
                        let volume: ISimpleAudioVolume = control.cast().ok()?;
                        return volume.GetMute().ok().map(|mute| mute.as_bool());
                    }
                }
                None
            }
            _ => None,
        }
    }
}

// Se o player atual (ou o que contém "app" no nome) está tocando.
pub fn playing(app: &str) -> Option<bool> {
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status;
    let session = session(app).ok()??;
    let status = session.GetPlaybackInfo().ok()?.PlaybackStatus().ok()?;
    Some(status == Status::Playing)
}

fn session(app: &str) -> windows::core::Result<Option<Session>> {
    let manager = Manager::RequestAsync()?.get()?;
    let wanted = app.trim().to_lowercase();
    if wanted.is_empty() {
        return Ok(manager.GetCurrentSession().ok());
    }
    for session in manager.GetSessions()? {
        if session.SourceAppUserModelId()?.to_string().to_lowercase().contains(&wanted) {
            return Ok(Some(session));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_fica_entre_0_e_100() {
        assert_eq!(stepped(0.98, "up", 5), 1.0);
        assert_eq!(stepped(0.02, "down", 5), 0.0);
        assert!((stepped(0.5, "up", 10) - 0.6).abs() < 1e-6);
    }

    #[test]
    fn mudo_alterna_e_forca() {
        assert_eq!(muted(true, "toggle"), Some(false));
        assert_eq!(muted(false, "mute"), Some(true));
        assert_eq!(muted(true, "up"), None);
    }
}
