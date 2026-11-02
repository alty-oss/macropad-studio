// Ações do app: cada macro liga a tecla virtual gravada num slot a uma lista de etapas.
// O mesmo formato é usado pela interface (src/device/protocol.ts).
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const VERSION: u32 = 2;

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
    },
    Homeassistant {
        service: String,
        entity: String,
    },
    Midi {
        port: String,
        channel: u8,
        control: u8,
        // "set" grava o valor; "add" soma ao último valor enviado (bom para knobs).
        mode: String,
        value: i32,
    },
    Voicemeeter {
        parameter: String,
        // "set", "add" ou "toggle".
        mode: String,
        #[serde(default)]
        value: f64,
    },
    Player {
        #[serde(default)]
        app: String,
        action: String,
    },
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

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HomeAssistantSettings {
    pub url: String,
}

// Preferências do app. Senhas e tokens ficam no Gerenciador de Credenciais do Windows.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub osd: bool,
    pub obs: ObsSettings,
    pub homeassistant: HomeAssistantSettings,
}
impl Default for Settings {
    fn default() -> Self {
        Self { osd: true, obs: ObsSettings::default(), homeassistant: HomeAssistantSettings::default() }
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
}

impl Default for Config {
    fn default() -> Self {
        Self { version: VERSION, macros: Vec::new(), labels: Vec::new(), settings: Settings::default() }
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
                (config, None)
            }
            Err(error) => (Self::default(), Some(set_aside(path, &error.to_string()))),
        }
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
        assert!(fs::read_to_string(&path).unwrap().contains("\"version\": 2"));
        fs::remove_dir_all(dir).ok();
    }
}
