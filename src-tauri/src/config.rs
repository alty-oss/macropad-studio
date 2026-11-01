// Ações do app: cada macro liga a tecla virtual gravada num slot a uma lista de etapas.
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Step {
    Open {
        path: String,
        #[serde(default)]
        args: String,
    },
    Website {
        url: String,
    },
    Text {
        text: String,
    },
    Hotkey {
        mods: u8,
        code: u8,
    },
    Delay {
        ms: u64,
    },
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
}

#[derive(Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub macros: Vec<Macro>,
}

impl Config {
    pub fn load(path: &Path) -> Self {
        fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
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
