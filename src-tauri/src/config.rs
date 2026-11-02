// Ações do app: cada macro liga a tecla virtual gravada num slot a uma lista de etapas.
// O mesmo formato é usado pela interface (src/device/protocol.ts).
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const VERSION: u32 = 3;

fn five() -> u8 {
    5
}
fn one() -> i32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Step {
    Open {
        path: String,
        #[serde(default)]
        args: String,
        // Se o programa já estiver aberto, traz a janela para frente em vez de abrir outra.
        #[serde(default)]
        focus: bool,
    },
    Website {
        url: String,
    },
    Text {
        text: String,
        // Cola pela área de transferência em vez de digitar caractere por caractere.
        #[serde(default)]
        paste: bool,
    },
    Hotkey {
        mods: u8,
        code: u8,
    },
    Delay {
        ms: u64,
    },
    Media {
        key: String,
    },
    Command {
        command: String,
        #[serde(default)]
        hidden: bool,
    },
    Http {
        method: String,
        url: String,
        #[serde(default)]
        headers: String,
        #[serde(default)]
        body: String,
    },
    Audio {
        // "mic", "output" ou "app" (volume de um programa).
        target: String,
        #[serde(default)]
        app: String,
        // "toggle", "mute", "unmute", "up" ou "down".
        action: String,
        #[serde(default = "five")]
        amount: u8,
    },
    Window {
        action: String,
    },
    System {
        action: String,
    },
    Mouse {
        action: String,
        #[serde(default = "one")]
        amount: i32,
    },
    Sound {
        path: String,
    },
    Counter {
        path: String,
        // 0 zera o contador.
        change: i64,
    },
    Brightness {
        change: i32,
    },
    Obs {
        action: String,
        #[serde(default)]
        scene: String,
        #[serde(default)]
        source: String,
        #[serde(default)]
        amount: f64,
        #[serde(default)]
        path: String,
    },
    Voicemeeter {
        parameter: String,
        // "set", "add" ou "toggle".
        mode: String,
        #[serde(default)]
        value: f64,
    },
    // Etapa de um tipo que o app não tem mais (Home Assistant, MIDI e Player, por exemplo). Só existe para
    // ler arquivos antigos sem perder o resto; Config::load as descarta.
    #[serde(other)]
    Removed,
}

// Etapas usadas quando o programa em foco é "app" (nome do executável, como photoshop.exe).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Profile {
    pub app: String,
    pub steps: Vec<Step>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    // Cada pressão executa as etapas.
    #[default]
    Normal,
    // As pressões alternam entre "steps" e "alt".
    Toggle,
    // Toque executa "steps"; segurar executa "alt".
    Hold,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Macro {
    pub layer: u8,
    pub slot: u8,
    pub mods: u8,
    pub code: u8,
    #[serde(default)]
    pub multi: bool,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub alt: Vec<Step>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

// Ações que existem somente na página remota do celular. Elas não possuem
// camada/código HID: o slot é reservado apenas para o servidor LAN. Um botão com
// `folder` diferente de zero abre a pasta com esse id em vez de executar etapas.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MobileButton {
    pub slot: u8,
    #[serde(default)]
    pub folder: u8,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
    // Imagem da tecla em data URL (PNG, JPEG, WebP ou GIF), já reduzida pelo editor. "fit" é
    // "icon" (no lugar do ícone) ou "cover" (cobre a tecla inteira).
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub fit: String,
    #[serde(default)]
    pub multi: bool,
    pub steps: Vec<Step>,
    #[serde(default)]
    pub mode: Mode,
    #[serde(default)]
    pub alt: Vec<Step>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
}

// Tamanho máximo do data URL de uma imagem de botão (o editor reduz as imagens bem abaixo disso).
pub const MOBILE_IMAGE_LIMIT: usize = 600_000;

// Tipo e bytes de um data URL de imagem aceito nos botões do celular. SVG fica de fora: aberto direto
// no navegador, poderia executar scripts na origem do servidor.
pub fn decode_image(data: &str) -> Option<(String, Vec<u8>)> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if data.len() > MOBILE_IMAGE_LIMIT { return None; }
    let (mime, encoded) = data.strip_prefix("data:")?.split_once(";base64,")?;
    if !matches!(mime, "image/png" | "image/jpeg" | "image/webp" | "image/gif") { return None; }
    let bytes = STANDARD.decode(encoded.trim()).ok()?;
    (!bytes.is_empty()).then(|| (mime.to_string(), bytes))
}

impl Step {
    // Ações incrementais (volume, brilho, rolagem, valores "somar"): no macropad ficam nos giros
    // dos knobs; no celular viram botões que repetem enquanto são segurados.
    pub fn is_incremental(&self) -> bool {
        match self {
            Step::Brightness { .. } => true,
            Step::Audio { action, .. } => action == "up" || action == "down",
            Step::Obs { action, .. } => action == "volume",
            Step::Mouse { action, .. } => action.starts_with("scroll"),
            Step::Voicemeeter { mode, .. } => mode == "add",
            _ => false,
        }
    }
}

impl MobileButton {
    pub fn as_macro(&self, layer: u8) -> Macro {
        Macro {
            layer,
            slot: self.slot,
            mods: 0,
            code: 0,
            multi: self.multi,
            steps: self.steps.clone(),
            mode: self.mode,
            alt: self.alt.clone(),
            profiles: self.profiles.clone(),
        }
    }
}

// Pasta do celular: outra página de 15 botões. O botão 1 de toda pasta é o "Voltar",
// desenhado pelo celular, então nenhum botão salvo ocupa esse slot.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MobileFolder {
    pub id: u8,
    pub name: String,
    pub buttons: Vec<MobileButton>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MobilePage {
    pub buttons: Vec<MobileButton>,
    pub folders: Vec<MobileFolder>,
}

// O executor identifica cada controle por (camada, slot). As camadas 1–3 são do macropad; a página
// principal do celular usa a camada 0 e a pasta N usa MOBILE_FOLDER_LAYER + N.
pub const MOBILE_FOLDER_LAYER: u8 = 100;
pub const MOBILE_MAX_FOLDER: u8 = u8::MAX - MOBILE_FOLDER_LAYER;

pub fn mobile_layer(page: u8) -> u8 {
    if page == 0 { 0 } else { MOBILE_FOLDER_LAYER.saturating_add(page) }
}

pub fn mobile_page_of(layer: u8) -> Option<u8> {
    match layer {
        0 => Some(0),
        layer if layer > MOBILE_FOLDER_LAYER => Some(layer - MOBILE_FOLDER_LAYER),
        _ => None,
    }
}

impl MobilePage {
    pub fn buttons_of(&self, page: u8) -> Option<&[MobileButton]> {
        if page == 0 { return Some(&self.buttons); }
        self.folders.iter().find(|folder| folder.id == page).map(|folder| folder.buttons.as_slice())
    }

    pub fn button(&self, page: u8, slot: u8) -> Option<&MobileButton> {
        self.buttons_of(page)?.iter().find(|button| button.slot == slot)
    }
}

// Legenda, ícone e cor escolhidos pelo usuário para um controle.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Label {
    pub layer: u8,
    pub slot: u8,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct ObsSettings {
    pub enabled: bool,
    pub host: String,
    pub port: u16,
}
impl Default for ObsSettings {
    fn default() -> Self {
        Self { enabled: false, host: "127.0.0.1".into(), port: 4455 }
    }
}

// Preferências do app. Senhas e tokens ficam no Gerenciador de Credenciais do Windows.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub osd: bool,
    pub sound_volume: u8,
    pub always_admin: bool,
    pub obs: ObsSettings,
    pub mobile: MobileSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct MobileSettings {
    pub enabled: bool,
    pub port: u16,
}
impl Default for MobileSettings {
    fn default() -> Self { Self { enabled: false, port: 38800 } }
}
impl Default for Settings {
    fn default() -> Self {
        Self { osd: true, sound_volume: 100, always_admin: false, obs: ObsSettings::default(), mobile: MobileSettings::default() }
    }
}

#[derive(Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub macros: Vec<Macro>,
    #[serde(default)]
    pub labels: Vec<Label>,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub mobile: MobilePage,
}

impl Default for Config {
    fn default() -> Self {
        Self { version: VERSION, macros: Vec::new(), labels: Vec::new(), settings: Settings::default(), mobile: MobilePage::default() }
    }
}

impl Config {
    // Lê a configuração. Um arquivo que não pode ser lido é guardado com outro nome antes de
    // começar do zero, para que a próxima gravação não apague as macros; o texto devolvido avisa
    // o usuário.
    pub fn load(path: &Path) -> (Self, Option<String>) {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (Self::default(), None),
            Err(error) => return (Self::default(), Some(set_aside(path, &error.to_string()))),
        };
        match serde_json::from_str::<Self>(&text) {
            Ok(mut config) => {
                // Versão 1 não tinha o campo; os campos novos já entram com os valores padrão.
                config.version = VERSION;
                let removed = config.drop_removed_steps();
                if removed == 0 { return (config, None); }
                // Grava já sem elas, para o aviso aparecer uma vez só.
                let saved = config.save(path);
                let notice = format!("{removed} {} de recursos que saíram do app (Home Assistant, MIDI, Player) {} das ações.", if removed == 1 { "etapa" } else { "etapas" }, if removed == 1 { "foi removida" } else { "foram removidas" });
                (config, Some(match saved { Ok(()) => notice, Err(error) => format!("{notice} Não foi possível gravar a configuração: {error}") }))
            }
            Err(error) => (Self::default(), Some(set_aside(path, &error.to_string()))),
        }
    }

    // Tira as etapas de tipos removidos de todas as ações e devolve quantas eram.
    fn drop_removed_steps(&mut self) -> usize {
        fn clean(steps: &mut Vec<Step>) -> usize {
            let before = steps.len();
            steps.retain(|step| *step != Step::Removed);
            before - steps.len()
        }
        fn lists(steps: &mut Vec<Step>, alt: &mut Vec<Step>, profiles: &mut [Profile]) -> usize {
            clean(steps) + clean(alt) + profiles.iter_mut().map(|profile| clean(&mut profile.steps)).sum::<usize>()
        }
        let macros: usize = self.macros.iter_mut().map(|item| lists(&mut item.steps, &mut item.alt, &mut item.profiles)).sum();
        let buttons = self.mobile.buttons.iter_mut().chain(self.mobile.folders.iter_mut().flat_map(|folder| folder.buttons.iter_mut()));
        let mobile: usize = buttons.map(|button| lists(&mut button.steps, &mut button.alt, &mut button.profiles)).sum();
        // Botões do celular que ficaram sem nenhuma etapa deixam de existir.
        self.mobile.buttons.retain(|button| button.folder != 0 || !button.steps.is_empty() || button.multi);
        for folder in &mut self.mobile.folders { folder.buttons.retain(|button| button.folder != 0 || !button.steps.is_empty() || button.multi); }
        macros + mobile
    }

    // Grava num arquivo temporário e renomeia, para não deixar um JSON pela metade.
    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let temporary = path.with_extension("json.tmp");
        let text = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        fs::write(&temporary, text).map_err(|e| e.to_string())?;
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    }
}

fn set_aside(path: &Path, reason: &str) -> String {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let backup: PathBuf = path.with_file_name(format!("config-invalido-{seconds}.json"));
    match fs::rename(path, &backup) {
        Ok(()) => format!(
            "A configuração do app não pôde ser lida ({reason}) e foi guardada em {}. As ações do app começaram vazias.",
            backup.display()
        ),
        Err(error) => format!("A configuração do app não pôde ser lida ({reason}) nem guardada à parte ({error})."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("macropad-studio-test-{name}-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn arquivo_corrompido_e_guardado_a_parte() {
        let dir = temporary_dir("corrompido");
        let path = dir.join("config.json");
        fs::write(&path, "{ isto não é json").unwrap();
        let (config, warning) = Config::load(&path);
        assert!(config.macros.is_empty());
        assert!(warning.unwrap().contains("config-invalido-"));
        assert!(!path.exists());
        let kept: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|entry| entry.ok()).collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(fs::read_to_string(kept[0].path()).unwrap(), "{ isto não é json");
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn arquivo_ausente_comeca_vazio_sem_aviso() {
        let dir = temporary_dir("ausente");
        let (config, warning) = Config::load(&dir.join("config.json"));
        assert!(config.macros.is_empty() && warning.is_none());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn etapas_de_recursos_removidos_saem_sem_perder_o_resto() {
        let dir = temporary_dir("removidos");
        let path = dir.join("config.json");
        let old = r#"{"version":3,"settings":{"homeassistant":{"url":"http://ha"}},"macros":[{"layer":1,"slot":1,"mods":0,"code":104,"steps":[{"type":"homeassistant","service":"toggle","entity":"light.sala"},{"type":"player","app":"","action":"playPause"},{"type":"delay","ms":10}]}],"mobile":{"buttons":[{"slot":2,"steps":[{"type":"midi","port":"x","channel":1,"control":7,"mode":"set","value":1}]}]}}"#;
        fs::write(&path, old).unwrap();
        let (config, warning) = Config::load(&path);
        assert!(warning.unwrap().contains("3 etapas"));
        assert_eq!(config.macros[0].steps, vec![Step::Delay { ms: 10 }]);
        assert!(config.mobile.buttons.is_empty());
        let saved = fs::read_to_string(&path).unwrap();
        assert!(!saved.contains("homeassistant") && !saved.contains("midi"));
        let (_, again) = Config::load(&path);
        assert!(again.is_none());
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn le_a_versao_1_e_grava_a_atual() {
        let dir = temporary_dir("v1");
        let path = dir.join("config.json");
        let v1 = r#"{"macros":[{"layer":1,"slot":1,"mods":0,"code":104,"steps":[{"type":"open","path":"C:\\a.exe"}]}]}"#;
        fs::write(&path, v1).unwrap();
        let (config, warning) = Config::load(&path);
        assert!(warning.is_none());
        assert_eq!(config.version, VERSION);
        assert_eq!(config.macros[0].mode, Mode::Normal);
        assert_eq!(config.macros[0].steps[0], Step::Open { path: "C:\\a.exe".into(), args: String::new(), focus: false });
        config.save(&path).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains("\"version\": 3"));
        fs::remove_dir_all(dir).ok();
    }
}
