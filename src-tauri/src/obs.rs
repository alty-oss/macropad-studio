// Cliente do obs-websocket v5, que vem com o OBS Studio 28 ou mais novo. Uma thread mantém a
// conexão, reconecta quando o OBS abre ou fecha e acompanha gravação, transmissão e cena atual.
use crate::config::ObsSettings;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::ErrorKind,
    net::{TcpStream, ToSocketAddrs},
    sync::{mpsc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket};

// Assinaturas de eventos: General (1), Scenes (4) e Outputs (64).
const EVENTS: u32 = 1 | 4 | 64;
const RETRY: Duration = Duration::from_secs(3);
const REPLY_TIMEOUT: Duration = Duration::from_secs(4);

#[derive(Clone, Debug, Default, Serialize)]
pub struct ObsStatus {
    pub connected: bool,
    pub recording: bool,
    pub streaming: bool,
    pub scene: String,
    pub error: String,
}

type Reply = mpsc::Sender<Result<Value, String>>;

enum Command {
    Request(String, Value, Reply),
    Configure(ObsSettings, String),
}

pub struct Obs {
    commands: Mutex<mpsc::Sender<Command>>,
    status: Mutex<ObsStatus>,
}

type OnStatus = Box<dyn Fn(&ObsStatus) + Send>;

impl Obs {
    pub fn start(settings: ObsSettings, password: String, on_status: impl Fn(&ObsStatus) + Send + 'static) -> &'static Obs {
        let (commands, queue) = mpsc::channel();
        let obs: &'static Obs = Box::leak(Box::new(Obs { commands: Mutex::new(commands), status: Mutex::default() }));
        let on_status: OnStatus = Box::new(on_status);
        thread::spawn(move || run(obs, queue, settings, password, on_status));
        obs
    }

    pub fn status(&self) -> ObsStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn configure(&self, settings: ObsSettings, password: String) {
        self.commands.lock().unwrap().send(Command::Configure(settings, password)).ok();
    }

    pub fn request(&self, kind: &str, data: Value) -> Result<Value, String> {
        let (reply, answer) = mpsc::channel();
        self.commands.lock().unwrap().send(Command::Request(kind.into(), data, reply)).map_err(|e| e.to_string())?;
        answer.recv_timeout(REPLY_TIMEOUT).map_err(|_| "O OBS não respondeu a tempo.".to_string())?
    }

    fn names(&self, kind: &str, data: Value, list: &str, field: &str) -> Result<Vec<String>, String> {
        let response = self.request(kind, data)?;
        Ok(response[list].as_array().into_iter().flatten().filter_map(|item| item[field].as_str().map(String::from)).collect())
    }

    pub fn scenes(&self) -> Result<Vec<String>, String> {
        let mut scenes = self.names("GetSceneList", Value::Null, "scenes", "sceneName")?;
        // O OBS lista as cenas de baixo para cima.
        scenes.reverse();
        Ok(scenes)
    }

    pub fn inputs(&self) -> Result<Vec<String>, String> {
        self.names("GetInputList", Value::Null, "inputs", "inputName")
    }

    pub fn scene_sources(&self, scene: &str) -> Result<Vec<String>, String> {
        self.names("GetSceneItemList", json!({ "sceneName": scene }), "sceneItems", "sourceName")
    }

    // Executa uma etapa "obs" e devolve o texto para o OSD.
    pub fn run_action(&self, action: &str, scene: &str, source: &str, amount: f64) -> Result<String, String> {
        let simple = |kind: &str, text: &str| self.request(kind, Value::Null).map(|_| text.to_string());
        match action {
            "scene" => self.request("SetCurrentProgramScene", json!({ "sceneName": scene })).map(|_| format!("Cena · {scene}")),
            "record" => self.request("ToggleRecord", Value::Null).map(|r| if r["outputActive"].as_bool() == Some(true) { "● Gravando".into() } else { "Gravação parada".into() }),
            "recordStart" => simple("StartRecord", "● Gravando"),
            "recordStop" => simple("StopRecord", "Gravação parada"),
            "recordPause" => simple("ToggleRecordPause", "Gravação pausada / retomada"),
            "stream" => self.request("ToggleStream", Value::Null).map(|r| if r["outputActive"].as_bool() == Some(true) { "● Ao vivo".into() } else { "Transmissão encerrada".into() }),
            "streamStart" => simple("StartStream", "● Ao vivo"),
            "streamStop" => simple("StopStream", "Transmissão encerrada"),
            "virtualcam" => simple("ToggleVirtualCam", "Câmera virtual alternada"),
            "replay" => simple("SaveReplayBuffer", "Replay salvo"),
            "transition" => simple("TriggerStudioModeTransition", "Transição"),
            "chapter" => simple("CreateRecordChapter", "Marcador adicionado"),
            "mute" => self
                .request("ToggleInputMute", json!({ "inputName": source }))
                .map(|r| format!("{source} {}", if r["inputMuted"].as_bool() == Some(true) { "mudo" } else { "ativado" })),
            "visibility" => {
                let target = if scene.is_empty() { self.status().scene } else { scene.to_string() };
                let id = self.request("GetSceneItemId", json!({ "sceneName": target, "sourceName": source }))?["sceneItemId"].clone();
                let enabled = self.request("GetSceneItemEnabled", json!({ "sceneName": target, "sceneItemId": id }))?["sceneItemEnabled"].as_bool().unwrap_or(false);
                self.request("SetSceneItemEnabled", json!({ "sceneName": target, "sceneItemId": id, "sceneItemEnabled": !enabled }))?;
                Ok(format!("{source} {}", if enabled { "oculto" } else { "visível" }))
            }
            "volume" => {
                let current = self.request("GetInputVolume", json!({ "inputName": source }))?["inputVolumeDb"].as_f64().unwrap_or(0.0);
                let next = volume_db(current, amount);
                self.request("SetInputVolume", json!({ "inputName": source, "inputVolumeDb": next }))?;
                Ok(format!("{source} · {next:.1} dB"))
            }
            _ => Err(format!("Ação do OBS desconhecida: {action}.")),
        }
    }
}

// O OBS aceita de -100 dB (mudo) a +26 dB. Um valor "-inf" volta como 0 do JSON; partimos de -100.
pub fn volume_db(current: f64, change: f64) -> f64 {
    let current = if current.is_finite() { current } else { -100.0 };
    ((current + change) * 10.0).round().clamp(-1000.0, 260.0) / 10.0
}

pub fn authentication(password: &str, salt: &str, challenge: &str) -> String {
    let secret = STANDARD.encode(Sha256::digest(format!("{password}{salt}")));
    STANDARD.encode(Sha256::digest(format!("{secret}{challenge}")))
}

type Socket = WebSocket<TcpStream>;

fn connect(settings: &ObsSettings, password: &str) -> Result<Socket, String> {
    let address = (settings.host.as_str(), settings.port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("Endereço do OBS inválido.")?;
    let stream = TcpStream::connect_timeout(&address, Duration::from_secs(2)).map_err(|_| "OBS fechado ou obs-websocket desligado.".to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    let (mut socket, _) = tungstenite::client(format!("ws://{}:{}", settings.host, settings.port), stream).map_err(|e| e.to_string())?;
    let hello = read_json(&mut socket)?;
    let mut identify = json!({ "rpcVersion": 1, "eventSubscriptions": EVENTS });
    if let Some(auth) = hello["d"].get("authentication") {
        if password.is_empty() {
            return Err("O OBS pede senha: informe a senha do obs-websocket nas Configurações.".into());
        }
        identify["authentication"] = json!(authentication(password, auth["salt"].as_str().unwrap_or(""), auth["challenge"].as_str().unwrap_or("")));
    }
    socket.send(Message::Text(json!({ "op": 1, "d": identify }).to_string())).map_err(|e| e.to_string())?;
    let identified = read_json(&mut socket).map_err(|_| "Senha do obs-websocket incorreta.".to_string())?;
    if identified["op"] != 2 {
        return Err("Senha do obs-websocket incorreta.".into());
    }
    // Depois do handshake, a leitura não bloqueia: a mesma thread também envia os pedidos.
    socket.get_ref().set_nonblocking(true).map_err(|e| e.to_string())?;
    Ok(socket)
}

fn read_json(socket: &mut Socket) -> Result<Value, String> {
    loop {
        match socket.read().map_err(|e| e.to_string())? {
            Message::Text(text) => return serde_json::from_str(&text).map_err(|e| e.to_string()),
            Message::Close(_) => return Err("O OBS fechou a conexão.".into()),
            _ => continue,
        }
    }
}

fn set_status(obs: &Obs, on_status: &OnStatus, change: impl FnOnce(&mut ObsStatus)) {
    let snapshot = {
        let mut status = obs.status.lock().unwrap();
        let before = format!("{status:?}");
        change(&mut status);
        if format!("{status:?}") == before {
            return;
        }
        status.clone()
    };
    on_status(&snapshot);
}

fn run(obs: &'static Obs, queue: mpsc::Receiver<Command>, mut settings: ObsSettings, mut password: String, on_status: OnStatus) {
    let mut next_try = Instant::now();
    let mut socket: Option<Socket> = None;
    let mut pending: HashMap<String, Reply> = HashMap::new();
    let mut counter = 0u64;
    loop {
        // Pedidos e mudanças de configuração.
        loop {
            match queue.try_recv() {
                Ok(Command::Configure(new_settings, new_password)) => {
                    settings = new_settings;
                    password = new_password;
                    socket = None;
                    next_try = Instant::now();
                    set_status(obs, &on_status, |status| *status = ObsStatus::default());
                }
                Ok(Command::Request(kind, data, reply)) => {
                    let Some(open) = socket.as_mut() else {
                        let text = if settings.enabled { "O OBS não está conectado." } else { "Ative a integração com o OBS nas Configurações." };
                        reply.send(Err(text.into())).ok();
                        continue;
                    };
                    counter += 1;
                    let id = counter.to_string();
                    let message = json!({ "op": 6, "d": { "requestType": kind, "requestId": id, "requestData": data } });
                    match open.send(Message::Text(message.to_string())) {
                        Ok(()) => {
                            pending.insert(id, reply);
                        }
                        Err(tungstenite::Error::Io(error)) if error.kind() == ErrorKind::WouldBlock => {
                            pending.insert(id, reply);
                        }
                        Err(error) => {
                            reply.send(Err(error.to_string())).ok();
                        }
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return,
            }
        }
        if socket.is_none() && settings.enabled && Instant::now() >= next_try {
            match connect(&settings, &password) {
                Ok(open) => {
                    socket = Some(open);
                    set_status(obs, &on_status, |status| {
                        status.connected = true;
                        status.error.clear();
                    });
                    // Estado inicial: as respostas destes pedidos atualizam o status.
                    for kind in ["GetRecordStatus", "GetStreamStatus", "GetCurrentProgramScene"] {
                        let message = json!({ "op": 6, "d": { "requestType": kind, "requestId": format!("status-{kind}") } });
                        socket.as_mut().unwrap().send(Message::Text(message.to_string())).ok();
                    }
                }
                Err(error) => {
                    next_try = Instant::now() + RETRY;
                    set_status(obs, &on_status, |status| {
                        *status = ObsStatus { error, ..ObsStatus::default() };
                    });
                }
            }
        }
        let Some(open) = socket.as_mut() else {
            thread::sleep(Duration::from_millis(50));
            continue;
        };
        open.flush().ok();
        match open.read() {
            Ok(Message::Text(text)) => {
                let Ok(message) = serde_json::from_str::<Value>(&text) else { continue };
                handle_message(obs, &on_status, &mut pending, &message);
            }
            Ok(Message::Close(_)) => drop_connection(obs, &on_status, &mut socket, &mut pending, &mut next_try),
            Ok(_) => {}
            Err(tungstenite::Error::Io(error)) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(15)),
            Err(_) => drop_connection(obs, &on_status, &mut socket, &mut pending, &mut next_try),
        }
    }
}

fn drop_connection(obs: &Obs, on_status: &OnStatus, socket: &mut Option<Socket>, pending: &mut HashMap<String, Reply>, next_try: &mut Instant) {
    *socket = None;
    *next_try = Instant::now() + RETRY;
    for (_, reply) in pending.drain() {
        reply.send(Err("A conexão com o OBS caiu.".into())).ok();
    }
    set_status(obs, on_status, |status| *status = ObsStatus { error: "OBS desconectado.".into(), ..ObsStatus::default() });
}

fn handle_message(obs: &Obs, on_status: &OnStatus, pending: &mut HashMap<String, Reply>, message: &Value) {
    let data = &message["d"];
    match message["op"].as_u64() {
        // Resposta a um pedido.
        Some(7) => {
            let id = data["requestId"].as_str().unwrap_or("");
            let response = &data["responseData"];
            match id {
                "status-GetRecordStatus" => set_status(obs, on_status, |s| s.recording = response["outputActive"].as_bool().unwrap_or(false)),
                "status-GetStreamStatus" => set_status(obs, on_status, |s| s.streaming = response["outputActive"].as_bool().unwrap_or(false)),
                "status-GetCurrentProgramScene" => {
                    let scene = response["currentProgramSceneName"].as_str().unwrap_or("").to_string();
                    set_status(obs, on_status, |s| s.scene = scene);
                }
                _ => {
                    if let Some(reply) = pending.remove(id) {
                        let status = &data["requestStatus"];
                        let result = if status["result"].as_bool() == Some(true) {
                            Ok(response.clone())
                        } else {
                            Err(format!("OBS: {}", status["comment"].as_str().unwrap_or("o pedido falhou.")))
                        };
                        reply.send(result).ok();
                    }
                }
            }
        }
        // Evento.
        Some(5) => {
            let event = &data["eventData"];
            match data["eventType"].as_str() {
                Some("RecordStateChanged") => set_status(obs, on_status, |s| s.recording = event["outputActive"].as_bool().unwrap_or(false)),
                Some("StreamStateChanged") => set_status(obs, on_status, |s| s.streaming = event["outputActive"].as_bool().unwrap_or(false)),
                Some("CurrentProgramSceneChanged") => {
                    let scene = event["sceneName"].as_str().unwrap_or("").to_string();
                    set_status(obs, on_status, |s| s.scene = scene);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autenticacao_segue_o_protocolo_v5() {
        // Exemplo da documentação do obs-websocket 5.
        let auth = authentication("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY=");
        assert_eq!(auth, "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=");
    }

    #[test]
    fn volume_fica_dentro_do_limite() {
        assert_eq!(volume_db(-3.0, 2.0), -1.0);
        assert_eq!(volume_db(25.0, 5.0), 26.0);
        assert_eq!(volume_db(f64::NEG_INFINITY, 3.0), -97.0);
    }
}
