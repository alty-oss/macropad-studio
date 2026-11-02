//! Estado dos botões do celular: o ícone e o destaque mudam com o que está acontecendo, como
//! gravando no OBS (o botão vira "parar"), microfone mudo, player tocando, cena atual, valor de um
//! contador ou a segunda lista de uma multi-ação no modo alternar.
use crate::{
    config::{mobile_layer, Config, Mode, Step},
    obs::ObsStatus,
};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct ButtonState {
    // "live" (gravando, ao vivo), "on" (ativo), "warn" (pausado), "muted" (mudo ou escondido) ou
    // "off" (indisponível agora, como o OBS fechado).
    #[serde(skip_serializing_if = "str::is_empty")]
    pub tone: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

fn state(tone: &'static str, icon: Option<&'static str>) -> ButtonState {
    ButtonState { tone, icon, label: None }
}
fn off() -> ButtonState {
    state("off", None)
}

// O que precisa ser consultado fora do app (Windows, players, arquivos, Voicemeeter).
pub trait Probe {
    fn muted(&mut self, target: &str, app: &str) -> Option<bool>;
    fn playing(&mut self, app: &str) -> Option<bool>;
    fn light_theme(&mut self) -> bool;
    fn counter(&mut self, path: &str) -> i64;
    fn voicemeeter(&mut self, parameter: &str) -> Option<f32>;
}

// Leituras reais, guardadas durante uma passada para não repetir a mesma consulta em vários botões.
#[derive(Default)]
pub struct SystemProbe {
    muted: HashMap<(String, String), Option<bool>>,
    playing: HashMap<String, Option<bool>>,
    theme: Option<bool>,
    counters: HashMap<String, i64>,
    voicemeeter: HashMap<String, Option<f32>>,
}

impl Probe for SystemProbe {
    fn muted(&mut self, target: &str, app: &str) -> Option<bool> {
        *self.muted.entry((target.into(), app.into())).or_insert_with(|| crate::audio::muted_state(target, app))
    }
    fn playing(&mut self, app: &str) -> Option<bool> {
        *self.playing.entry(app.into()).or_insert_with(|| crate::audio::playing(app))
    }
    fn light_theme(&mut self) -> bool {
        *self.theme.get_or_insert_with(crate::system::light_theme)
    }
    fn counter(&mut self, path: &str) -> i64 {
        *self.counters.entry(path.into()).or_insert_with(|| crate::system::counter_value(path))
    }
    fn voicemeeter(&mut self, parameter: &str) -> Option<f32> {
        *self.voicemeeter.entry(parameter.into()).or_insert_with(|| crate::integrations::voicemeeter_value(parameter))
    }
}

// Estado de uma etapa; None quando ela não tem estado ou está no estado normal.
pub fn step_state(step: &Step, obs: &ObsStatus, probe: &mut dyn Probe) -> Option<ButtonState> {
    match step {
        Step::Obs { action, scene, source, .. } => {
            if !obs.connected { return Some(off()); }
            match action.as_str() {
                "record" => obs.recording.then(|| state(if obs.record_paused { "warn" } else { "live" }, Some("stop"))),
                "recordStart" => obs.recording.then(|| state("live", None)),
                "recordStop" | "chapter" => (!obs.recording).then(off),
                "recordPause" => Some(if !obs.recording { off() } else if obs.record_paused { state("warn", Some("play")) } else { state("", Some("pause")) }),
                "stream" => obs.streaming.then(|| state("live", Some("stop"))),
                "streamStart" => obs.streaming.then(|| state("live", None)),
                "streamStop" => (!obs.streaming).then(off),
                "virtualcam" => obs.virtualcam.then(|| state("on", None)),
                "replay" => (!obs.replay_buffer).then(off),
                "scene" => (!scene.trim().is_empty() && obs.scene == scene.trim()).then(|| state("on", None)),
                "mute" => obs.mutes.get(source.trim()).copied().filter(|muted| *muted).map(|_| state("muted", Some("micOff"))),
                "visibility" => obs.visible(scene, source).filter(|visible| !visible).map(|_| state("muted", Some("eyeOff"))),
                _ => None,
            }
        }
        Step::Audio { target, app, action, .. } if action != "up" && action != "down" => {
            probe.muted(target, app).filter(|muted| *muted).map(|_| state("muted", Some(if target == "mic" { "micOff" } else { "mute" })))
        }
        Step::Media { key } if key == "playPause" => probe.playing("").map(|playing| state("", Some(if playing { "pause" } else { "play" }))),
        Step::System { action } if action == "theme" => Some(state("", Some(if probe.light_theme() { "sun" } else { "moon" }))),
        Step::Counter { path, .. } if !path.trim().is_empty() => Some(ButtonState { label: Some(probe.counter(path).to_string()), ..ButtonState::default() }),
        Step::Voicemeeter { parameter, mode, .. } if mode == "toggle" => probe.voicemeeter(parameter).filter(|value| *value >= 0.5).map(|_| state("on", None)),
        _ => None,
    }
}

// Estado de um botão: no modo alternar, a segunda lista acende o botão com o ícone dela; nos
// outros, vale o estado da primeira etapa.
pub fn button_state(steps: &[Step], mode: Mode, alt: &[Step], toggled: bool, obs: &ObsStatus, probe: &mut dyn Probe) -> Option<ButtonState> {
    if mode == Mode::Toggle && toggled {
        return Some(state("on", alt.first().map(step_icon)));
    }
    steps.first().and_then(|step| step_state(step, obs, probe))
}

// Estados de todos os botões com ação: "m:<pasta>:<slot>" no celular e "p:<camada>:<slot>" no
// espelho do macropad. Botões no estado normal ficam de fora.
pub fn compute(config: &Config, obs: &ObsStatus, toggled: impl Fn(u8, u8) -> bool, probe: &mut dyn Probe) -> BTreeMap<String, ButtonState> {
    let mut states = BTreeMap::new();
    let pages = std::iter::once((0, &config.mobile.buttons)).chain(config.mobile.folders.iter().map(|folder| (folder.id, &folder.buttons)));
    for (page, buttons) in pages {
        for button in buttons.iter().filter(|button| button.folder == 0 && !button.steps.is_empty()) {
            if let Some(found) = button_state(&button.steps, button.mode, &button.alt, toggled(mobile_layer(page), button.slot), obs, probe) {
                states.insert(format!("m:{page}:{}", button.slot), found);
            }
        }
    }
    for item in &config.macros {
        if let Some(found) = button_state(&item.steps, item.mode, &item.alt, toggled(item.layer, item.slot), obs, probe) {
            states.insert(format!("p:{}:{}", item.layer, item.slot), found);
        }
    }
    states
}

// Ícone de uma etapa, o mesmo do "Auto" do editor.
pub fn step_icon(step: &Step) -> &'static str {
    match step {
        Step::Obs { action, .. } => match action.as_str() {
            "mute" => "mic",
            "visibility" => "eye",
            "record" | "recordStart" | "recordStop" | "recordPause" => "record",
            "stream" | "streamStart" | "streamStop" => "broadcast",
            "replay" => "replay",
            "screenshot" => "image",
            "scene" => "monitor",
            _ => "obs",
        },
        Step::Audio { target, action, .. } => match action.as_str() {
            "up" => "volumeUp",
            "down" => "volumeDown",
            _ if target == "mic" => "mic",
            _ => "mute",
        },
        Step::Mouse { action, .. } => if action.starts_with("scroll") { "arrowDown" } else { "mouse" },
        Step::Brightness { .. } => "sun",
        Step::Open { .. } => "folder",
        Step::Website { .. } => "globe",
        Step::Text { .. } => "text",
        Step::Hotkey { .. } => "keyboard",
        Step::Delay { .. } => "clock",
        Step::Media { .. } => "playPause",
        Step::Command { .. } => "terminal",
        Step::Http { .. } => "link",
        Step::Window { .. } => "window",
        Step::System { action } => if action == "theme" { "sun" } else { "power" },
        Step::Sound { .. } => "music",
        Step::Counter { .. } => "hash",
        Step::Voicemeeter { .. } => "mixer",
        Step::Removed => "bolt",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake { mic_muted: bool, playing: bool, counter: i64 }
    impl Probe for Fake {
        fn muted(&mut self, target: &str, _: &str) -> Option<bool> { (target == "mic").then_some(self.mic_muted) }
        fn playing(&mut self, _: &str) -> Option<bool> { Some(self.playing) }
        fn light_theme(&mut self) -> bool { false }
        fn counter(&mut self, _: &str) -> i64 { self.counter }
        fn voicemeeter(&mut self, _: &str) -> Option<f32> { None }
    }
    fn obs_step(action: &str) -> Step {
        Step::Obs { action: action.into(), scene: "Jogo".into(), source: "Mic".into(), amount: 0.0, path: String::new() }
    }

    #[test]
    fn gravacao_vira_parar_e_pausa_fica_amarela() {
        let mut obs = ObsStatus { connected: true, ..ObsStatus::default() };
        let probe = &mut Fake::default();
        assert_eq!(step_state(&obs_step("record"), &obs, probe), None);
        obs.recording = true;
        assert_eq!(step_state(&obs_step("record"), &obs, probe), Some(state("live", Some("stop"))));
        assert_eq!(step_state(&obs_step("recordPause"), &obs, probe), Some(state("", Some("pause"))));
        obs.record_paused = true;
        assert_eq!(step_state(&obs_step("record"), &obs, probe), Some(state("warn", Some("stop"))));
        assert_eq!(step_state(&obs_step("recordPause"), &obs, probe), Some(state("warn", Some("play"))));
    }

    #[test]
    fn obs_fechado_apaga_os_botoes_e_cena_atual_acende() {
        let mut obs = ObsStatus::default();
        let probe = &mut Fake::default();
        assert_eq!(step_state(&obs_step("scene"), &obs, probe), Some(off()));
        obs.connected = true;
        obs.scene = "Jogo".into();
        assert_eq!(step_state(&obs_step("scene"), &obs, probe), Some(state("on", None)));
        obs.mutes.insert("Mic".into(), true);
        assert_eq!(step_state(&obs_step("mute"), &obs, probe), Some(state("muted", Some("micOff"))));
        obs.items.insert(("Jogo".into(), "Mic".into()), (3, false));
        assert_eq!(step_state(&Step::Obs { action: "visibility".into(), scene: String::new(), source: "Mic".into(), amount: 0.0, path: String::new() }, &obs, probe), Some(state("muted", Some("eyeOff"))));
    }

    #[test]
    fn microfone_midia_contador_e_alternar() {
        let probe = &mut Fake { mic_muted: true, playing: true, counter: 7 };
        let obs = ObsStatus::default();
        let mic = Step::Audio { target: "mic".into(), app: String::new(), action: "toggle".into(), amount: 5 };
        assert_eq!(step_state(&mic, &obs, probe), Some(state("muted", Some("micOff"))));
        let media = Step::Media { key: "playPause".into() };
        assert_eq!(step_state(&media, &obs, probe), Some(state("", Some("pause"))));
        let counter = Step::Counter { path: "c.txt".into(), change: 1 };
        assert_eq!(step_state(&counter, &obs, probe).and_then(|found| found.label), Some("7".into()));
        let alt = [Step::Audio { target: "output".into(), app: String::new(), action: "unmute".into(), amount: 5 }];
        assert_eq!(button_state(std::slice::from_ref(&mic), Mode::Toggle, &alt, true, &obs, probe), Some(state("on", Some("mute"))));
    }
}
