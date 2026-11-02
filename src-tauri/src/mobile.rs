//! Servidor LAN do modo Stream Deck. O protocolo é propositalmente pequeno: o
//! navegador recebe apenas legendas/estado visual e envia eventos de pressão.
//! Não há pareamento: qualquer aparelho da rede que abrir o endereço usa os botões,
//! por isso o servidor só liga quando o usuário ativa e atende uma conexão por vez.

use crate::{config::{decode_image, mobile_layer, mobile_page_of, Mode, MobileButton, MobilePage, MobileSettings, Step}, executor::Job};
use if_addrs::IfAddr;
use qrcodegen::{QrCode, QrCodeEcc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{hash_map::DefaultHasher, BTreeSet, HashMap, HashSet},
    hash::{Hash, Hasher},
    io::{self, ErrorKind, Read, Write},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tungstenite::{accept_hdr, Message};
use tungstenite::handshake::server::{Request, Response};

const DEFAULT_PORT: u16 = 38800;
const MOBILE_PAGE: &str = include_str!("../../src/mobile.html");
// Os mesmos desenhos de ícones do editor, embutidos na página no lugar do marcador.
const ICONS_JSON: &str = include_str!("../../src/lib/icons.json");
const ICONS_MARKER: &str = "{/*ICONS*/}";
// Arquivos do app instalável (PWA): manifesto, service worker e ícones.
const ASSETS: &[(&str, &str, &[u8])] = &[
    ("/manifest.webmanifest", "application/manifest+json; charset=utf-8", include_bytes!("../../src/pwa/manifest.webmanifest")),
    ("/sw.js", "text/javascript; charset=utf-8", include_bytes!("../../src/pwa/sw.js")),
    ("/icon.svg", "image/svg+xml", include_bytes!("../../src/pwa/icon.svg")),
    ("/icon-192.png", "image/png", include_bytes!("../../src/pwa/icon-192.png")),
    ("/icon-512.png", "image/png", include_bytes!("../../src/pwa/icon-512.png")),
    ("/icon-maskable-512.png", "image/png", include_bytes!("../../src/pwa/icon-maskable-512.png")),
    ("/apple-touch-icon.png", "image/png", include_bytes!("../../src/pwa/apple-touch-icon.png")),
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSlot {
    pub slot: u8,
    pub kind: String,
    // Pasta aberta por este botão (0 quando não é pasta).
    #[serde(default)]
    pub folder: u8,
    // O celular repete o toque enquanto o botão é segurado (ações incrementais e giros de knob).
    #[serde(default)]
    pub repeat: bool,
    // Etapas equivalentes a um atalho ou mídia gravados no macropad, para o espelho executá-los
    // pelo app. Vêm do editor e não são enviadas ao celular.
    #[serde(default, skip_serializing)]
    pub steps: Vec<Step>,
    pub label: String,
    pub icon: String,
    pub color: String,
    // Endereço da imagem do botão (/image/<pasta>/<slot>?v=…) e o ajuste: "icon" ou "cover".
    #[serde(default)]
    pub image: String,
    #[serde(default)]
    pub fit: String,
    pub executable: bool,
    #[serde(default)]
    pub loaded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileLayer {
    pub layer: u8,
    pub loaded: bool,
    pub slots: Vec<MobileSlot>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MobileMirror {
    pub layers: Vec<MobileLayer>,
    pub detected_layer: Option<u8>,
    pub device_present: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileFolderView {
    pub id: u8,
    pub name: String,
    pub slots: Vec<MobileSlot>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileSnapshot {
    pub detected_layer: Option<u8>,
    pub device_present: bool,
    pub physical: Vec<MobileLayer>,
    pub mobile: Vec<MobileSlot>,
    pub folders: Vec<MobileFolderView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub connected: bool,
    pub urls: Vec<String>,
    pub qr_svg: Option<String>,
    pub error: String,
}

struct Control {
    enabled: bool,
    running: bool,
    port: u16,
    session: u64,
    connected: bool,
    tx: Option<mpsc::Sender<String>>,
    pressed: HashSet<(u8, u8)>,
    stop: Option<Arc<std::sync::atomic::AtomicBool>>,
    thread: Option<JoinHandle<()>>,
    error: String,
}

impl Control {
    fn new() -> Self {
        Self {
            enabled: false,
            running: false,
            port: DEFAULT_PORT,
            session: 0,
            connected: false,
            tx: None,
            pressed: HashSet::new(),
            stop: None,
            thread: None,
            error: String::new(),
        }
    }

    // Uma conexão nova substitui a anterior. O celular costuma voltar do segundo plano com a conexão
    // antiga ainda "aberta" aqui (o sistema a suspendeu sem fechar); recusar a nova deixava a página
    // sem atualizações até o tempo limite. Devolve as teclas que a sessão antiga segurava.
    fn register_session(&mut self, tx: mpsc::Sender<String>) -> (u64, HashSet<(u8, u8)>) {
        let pressed = if self.connected { std::mem::take(&mut self.pressed) } else { HashSet::new() };
        self.session = self.session.wrapping_add(1);
        self.connected = true;
        self.tx = Some(tx);
        (self.session, pressed)
    }
}

// Tipo (MIME) e bytes de uma imagem de botão.
type Image = (String, Vec<u8>);

pub struct MobileServer {
    app: AppHandle,
    control: Mutex<Control>,
    snapshot: Mutex<MobileSnapshot>,
    // Imagens dos botões por (pasta, slot), já decodificadas.
    images: Mutex<HashMap<(u8, u8), Image>>,
    // Últimos estados dos botões enviados ao celular (states.rs).
    states: Mutex<serde_json::Value>,
}

impl MobileServer {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self {
            app,
            control: Mutex::new(Control::new()),
            snapshot: Mutex::new(MobileSnapshot { detected_layer: None, device_present: false, physical: Vec::new(), mobile: mobile_slots(&[], 0), folders: Vec::new() }),
            images: Mutex::new(HashMap::new()),
            states: Mutex::new(json!({})),
        })
    }

    pub fn configure(self: &Arc<Self>, settings: MobileSettings) -> Result<(), String> {
        let port = if settings.port == 0 { DEFAULT_PORT } else { settings.port };
        if !settings.enabled {
            self.stop();
            let mut control = self.control.lock().unwrap();
            control.enabled = false;
            control.port = port;
            control.error.clear();
            return Ok(());
        }

        {
            let control = self.control.lock().unwrap();
            if control.running && control.port == port {
                return Ok(());
            }
        }
        self.stop();
        let listener = match TcpListener::bind(("0.0.0.0", port)) {
            Ok(listener) => listener,
            Err(error) => {
                let message = format!("Não foi possível abrir a porta {port}: {error}");
                let mut control = self.control.lock().unwrap();
                control.enabled = true;
                control.running = false;
                control.port = port;
                control.error = message.clone();
                return Err(message);
            }
        };
        listener.set_nonblocking(true).map_err(|error| error.to_string())?;
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let server = Arc::clone(self);
        let thread_stop = Arc::clone(&stop);
        let handle = thread::spawn(move || run_listener(server, listener, thread_stop));
        let (watcher, watcher_stop) = (Arc::clone(self), Arc::clone(&stop));
        thread::spawn(move || watch_states(watcher, watcher_stop));
        let mut control = self.control.lock().unwrap();
        control.enabled = true;
        control.running = true;
        control.port = port;
        control.session = control.session.wrapping_add(1);
        control.connected = false;
        control.tx = None;
        control.stop = Some(stop);
        control.thread = Some(handle);
        control.error.clear();
        Ok(())
    }

    pub fn stop(&self) {
        let (stop, thread, pressed) = {
            let mut control = self.control.lock().unwrap();
            control.running = false;
            control.connected = false;
            control.tx = None;
            (control.stop.take(), control.thread.take(), std::mem::take(&mut control.pressed))
        };
        self.release_pressed(pressed);
        if let Some(stop) = stop { stop.store(true, std::sync::atomic::Ordering::SeqCst); }
        if let Some(thread) = thread { let _ = thread.join(); }
    }

    // Derruba a conexão atual. O celular mostra "Toque para reconectar" em vez de voltar sozinho.
    pub fn disconnect(&self) {
        let mut control = self.control.lock().unwrap();
        control.session = control.session.wrapping_add(1);
        control.connected = false;
        control.tx = None;
        let pressed = std::mem::take(&mut control.pressed);
        drop(control);
        self.release_pressed(pressed);
    }

    pub fn status(&self) -> MobileStatus {
        let control = self.control.lock().unwrap();
        let urls = if control.running { local_urls(control.port) } else { Vec::new() };
        let qr_svg = urls.first().map(|url| qr_svg(url));
        MobileStatus {
            enabled: control.enabled,
            running: control.running,
            port: control.port,
            connected: control.connected,
            urls,
            qr_svg,
            error: control.error.clone(),
        }
    }

    pub fn sync_mirror(&self, mirror: MobileMirror) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.physical = mirror.layers;
        snapshot.detected_layer = mirror.detected_layer;
        snapshot.device_present = mirror.device_present;
        drop(snapshot);
        self.broadcast_state();
    }

    pub fn set_device_present(&self, present: bool) {
        self.snapshot.lock().unwrap().device_present = present;
        self.broadcast_state();
    }

    pub fn set_detected_layer(&self, layer: Option<u8>) {
        self.snapshot.lock().unwrap().detected_layer = layer;
        self.broadcast_state();
    }

    pub fn set_mobile_page(&self, page: &MobilePage) {
        let pages = std::iter::once((0, &page.buttons)).chain(page.folders.iter().map(|folder| (folder.id, &folder.buttons)));
        *self.images.lock().unwrap() = pages
            .flat_map(|(id, buttons)| buttons.iter().filter_map(move |button| decode_image(&button.image).map(|image| ((id, button.slot), image))))
            .collect();
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.mobile = mobile_slots(&page.buttons, 0);
        snapshot.folders = page.folders.iter().map(|folder| MobileFolderView { id: folder.id, name: folder.name.trim().to_string(), slots: mobile_slots(&folder.buttons, folder.id) }).collect();
        drop(snapshot);
        self.broadcast_state();
    }

    fn snapshot_message(&self) -> String {
        let snapshot = self.snapshot.lock().unwrap().clone();
        let states = self.states.lock().unwrap().clone();
        serde_json::to_string(&json!({ "type": "state", "state": snapshot, "states": states })).unwrap_or_default()
    }

    pub fn broadcast_state(&self) { self.broadcast(self.snapshot_message()); }

    pub fn broadcast_fired(&self, layer: u8, slot: u8, down: bool) {
        let message = match mobile_page_of(layer) {
            Some(page) => json!({ "type": "fired", "source": "mobile", "page": page, "slot": slot, "down": down }),
            None => json!({ "type": "fired", "source": "physical", "layer": layer, "slot": slot, "down": down }),
        };
        self.broadcast(serde_json::to_string(&message).unwrap_or_default());
    }

    fn broadcast(&self, message: String) {
        let tx = self.control.lock().unwrap().tx.clone();
        if let Some(tx) = tx { tx.send(message).ok(); }
    }

    fn log_connection(&self, detail: &str) {
        let state = self.app.state::<crate::AppState>();
        crate::append_log(&state.log_path, &format!("Conexão mobile: {detail}"));
    }

    fn register_session(&self, tx: mpsc::Sender<String>) -> u64 {
        let (session, pressed) = self.control.lock().unwrap().register_session(tx);
        self.release_pressed(pressed);
        session
    }

    fn session_current(&self, id: u64) -> bool {
        let control = self.control.lock().unwrap();
        control.running && control.connected && control.session == id
    }

    fn session_closed(&self, id: u64) {
        let mut control = self.control.lock().unwrap();
        if control.session == id {
            control.connected = false;
            control.tx = None;
            let pressed = std::mem::take(&mut control.pressed);
            drop(control);
            self.release_pressed(pressed);
        }
    }

    fn release_pressed(&self, pressed: HashSet<(u8, u8)>) {
        if pressed.is_empty() { return; }
        let state = self.app.state::<crate::AppState>();
        let jobs = state.jobs.lock().unwrap();
        for (layer, slot) in pressed {
            jobs.send(Job::Key(layer, slot, false)).ok();
        }
    }

    fn trigger(self: &Arc<Self>, source: &str, layer: Option<u8>, page: u8, slot: u8, down: bool) -> Result<(), String> {
        let state = self.app.state::<crate::AppState>();
        let (target_layer, target_slot) = if source == "mobile" {
            if !(1..=15).contains(&slot) { return Err("Botão mobile inválido.".into()); }
            let config = state.config.lock().unwrap();
            if !config.mobile.button(page, slot).is_some_and(|button| button.folder == 0 && !button.steps.is_empty()) {
                return Err("Este botão mobile não está configurado.".into());
            }
            (mobile_layer(page), slot)
        } else if source == "physical" {
            let layer = layer.ok_or("Informe a camada do macropad.")?;
            if !(1..=3).contains(&layer) { return Err("Camada inválida.".into()); }
            let snapshot = self.snapshot.lock().unwrap();
            let Some(item) = snapshot.physical.iter().find(|item| item.layer == layer).and_then(|item| item.slots.iter().find(|item| item.slot == slot)) else {
                return Err("Este controle ainda não foi sincronizado.".into());
            };
            if !item.executable { return Err("Este controle não tem uma ação que o app consiga executar.".into()); }
            // Atalho ou mídia gravados no aparelho: o app reproduz o envio no toque.
            if item.kind != "app" {
                let steps = item.steps.clone();
                drop(snapshot);
                if steps.is_empty() { return Err("Este controle não tem uma ação que o app consiga executar.".into()); }
                if down { state.jobs.lock().unwrap().send(Job::Run(steps)).map_err(|error| error.to_string())?; }
                return Ok(());
            }
            let config = state.config.lock().unwrap();
            if !config.macros.iter().any(|item| item.layer == layer && item.slot == slot) { return Err("A macro deste controle não está configurada.".into()); }
            (layer, slot)
        } else {
            return Err("Origem inválida.".into());
        };
        state.jobs.lock().unwrap().send(Job::Key(target_layer, target_slot, down)).map_err(|error| error.to_string())?;
        let key = (target_layer, target_slot);
        if down {
            self.control.lock().unwrap().pressed.insert(key);
            let server = Arc::clone(self);
            thread::spawn(move || {
                thread::sleep(Duration::from_secs(5));
                let release = server.control.lock().unwrap().pressed.remove(&key);
                if release { server.release_pressed(HashSet::from([key])); }
            });
        } else {
            self.control.lock().unwrap().pressed.remove(&key);
        }
        Ok(())
    }
}

// Recalcula o estado dos botões enquanto há um celular conectado e envia só quando algo muda.
fn watch_states(server: Arc<MobileServer>, stop: Arc<std::sync::atomic::AtomicBool>) {
    crate::executor::init_thread();
    let mut last: Option<serde_json::Value> = None;
    while !stop.load(std::sync::atomic::Ordering::SeqCst) {
        if server.control.lock().unwrap().connected {
            let current = {
                let state = server.app.state::<crate::AppState>();
                let obs = state.obs.status();
                let config = state.config.lock().unwrap();
                crate::states::compute(&config, &obs, crate::executor::toggled, &mut crate::states::SystemProbe::default())
            };
            let value = serde_json::to_value(&current).unwrap_or_else(|_| json!({}));
            if last.as_ref() != Some(&value) {
                *server.states.lock().unwrap() = value.clone();
                server.broadcast(json!({ "type": "states", "states": value }).to_string());
                last = Some(value);
            }
        } else {
            last = None;
        }
        thread::sleep(Duration::from_millis(400));
    }
}

fn run_listener(server: Arc<MobileServer>, listener: TcpListener, stop: Arc<std::sync::atomic::AtomicBool>) {
    while !stop.load(std::sync::atomic::Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                let server = Arc::clone(&server);
                let stop = Arc::clone(&stop);
                thread::spawn(move || handle_connection(server, stream, stop));
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(30)),
            Err(_) => break,
        }
    }
}

fn handle_connection(server: Arc<MobileServer>, stream: TcpStream, stop: Arc<std::sync::atomic::AtomicBool>) {
    if let Err(error) = prepare_connection(&stream) {
        server.log_connection(&format!("preparação do socket: {error}"));
        return;
    }
    let mut peek = [0u8; 8192];
    let size = loop {
        match stream.peek(&mut peek) {
            Ok(0) => return,
            Ok(size) => {
                let complete = peek[..size].windows(4).any(|window| window == b"\r\n\r\n");
                if complete || size == peek.len() { break size; }
            }
            Err(_) => return,
        }
        thread::sleep(Duration::from_millis(5));
    };
    let head = String::from_utf8_lossy(&peek[..size]).to_ascii_lowercase();
    if head.contains("upgrade: websocket") {
        handle_websocket(server, stream, stop);
    } else {
        // `peek` serve apenas para decidir entre HTTP e WebSocket. Os bytes
        // continuam no socket, então o parser HTTP precisa consumi-los uma
        // única vez em vez de receber uma cópia que poderia duplicar o
        // cabeçalho (o que quebrava alguns POSTs de pareamento).
        handle_http(&server, stream);
    }
}

fn prepare_connection(stream: &TcpStream) -> io::Result<()> {
    // No Windows, accept() herda o modo não bloqueante do listener. O
    // handshake até pode terminar, mas a leitura imediata do token falha
    // com WSAEWOULDBLOCK (10035) antes de o navegador enviar o frame.
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    Ok(())
}

fn handle_http(server: &MobileServer, mut stream: TcpStream) {
    let mut data = Vec::new();
    let header_end = loop {
        if let Some(position) = data.windows(4).position(|window| window == b"\r\n\r\n") { break position + 4; }
        let mut chunk = [0u8; 2048];
        match stream.read(&mut chunk) { Ok(0) | Err(_) => return, Ok(size) => data.extend_from_slice(&chunk[..size]) }
        if data.len() > 64 * 1024 { return; }
    };
    let headers = String::from_utf8_lossy(&data[..header_end]).to_string();
    let mut lines = headers.lines();
    let Some(request) = lines.next() else { return };
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    let length = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok()).flatten()
    }).unwrap_or(0);
    while data.len() < header_end + length {
        let mut chunk = [0u8; 2048];
        match stream.read(&mut chunk) { Ok(0) | Err(_) => return, Ok(size) => data.extend_from_slice(&chunk[..size]) }
    }
    let route = path.split('?').next().unwrap_or("/");
    if method != "GET" {
        response_json(&mut stream, 404, &json!({ "error": "Não encontrado." }));
    } else if route == "/" || route == "/index.html" {
        response(&mut stream, 200, "text/html; charset=utf-8", mobile_page_html().as_bytes());
    } else if let Some((_, content_type, body)) = ASSETS.iter().find(|(asset, _, _)| *asset == route) {
        response(&mut stream, 200, content_type, body);
    } else if let Some(image) = image_route(route).and_then(|key| server.images.lock().unwrap().get(&key).cloned()) {
        send(&mut stream, 200, &image.0, &image.1, "public, max-age=31536000, immutable");
    } else {
        response_json(&mut stream, 404, &json!({ "error": "Não encontrado." }));
    }
}

#[allow(clippy::result_large_err)]
fn handle_websocket(server: Arc<MobileServer>, stream: TcpStream, stop: Arc<std::sync::atomic::AtomicBool>) {
    let path = Arc::new(Mutex::new(String::new()));
    let callback_path = Arc::clone(&path);
    let mut socket = match accept_hdr(stream, move |request: &Request, response: Response| {
        *callback_path.lock().unwrap() = request.uri().to_string();
        Ok(response)
    }) {
        Ok(socket) => socket,
        Err(error) => { server.log_connection(&format!("handshake WebSocket: {error:?}")); return; }
    };
    if !path.lock().unwrap().starts_with("/ws") { return; }
    let (events, queue) = mpsc::channel();
    let session = server.register_session(events);
    if let Err(error) = socket.send(Message::Text(server.snapshot_message())) {
        server.log_connection(&format!("envio do estado inicial: {error}"));
        server.session_closed(session);
        return;
    }
    // No Windows, escrita em socket não bloqueante pode retornar WouldBlock e
    // encerrar a sessão quando uma atualização de estado coincide com leitura.
    // Um timeout curto permite processar a fila sem transformar a escrita em
    // operação não bloqueante.
    if socket.get_ref().set_read_timeout(Some(Duration::from_millis(100))).is_err() {
        server.session_closed(session);
        return;
    }
    let mut last_seen = Instant::now();
    while !stop.load(std::sync::atomic::Ordering::SeqCst) && server.session_current(session) {
        if last_seen.elapsed() > Duration::from_secs(90) {
            server.log_connection("sem resposta do celular por 90 segundos");
            break;
        }
        while let Ok(message) = queue.try_recv() {
            if let Err(error) = socket.send(Message::Text(message)) {
                server.log_connection(&format!("envio de atualização: {error}"));
                server.session_closed(session);
                return;
            }
        }
        let received = socket.read();
        if received.is_ok() { last_seen = Instant::now(); }
        match received {
            Ok(Message::Text(text)) => match serde_json::from_str::<ClientMessage>(&text.to_string()) {
                Ok(ClientMessage::Trigger { source, layer, page, slot, down }) => {
                    if let Err(error) = server.trigger(&source, layer, page, slot, down) {
                        let _ = socket.send(Message::Text(json!({ "type": "error", "message": error }).to_string()));
                    }
                }
                Ok(ClientMessage::Ping) => { let _ = socket.send(Message::Text(json!({ "type": "pong" }).to_string())); }
                // O celular voltou do segundo plano e pede o estado atual.
                Ok(ClientMessage::Sync) => { let _ = socket.send(Message::Text(server.snapshot_message())); }
                Err(_) => { let _ = socket.send(Message::Text(json!({ "type": "error", "message": "Mensagem inválida." }).to_string())); }
            },
            Ok(Message::Ping(payload)) => { let _ = socket.send(Message::Pong(payload)); }
            Ok(Message::Close(_)) => break,
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
            Err(error) => { server.log_connection(&format!("leitura WebSocket: {error}")); break; }
            _ => {}
        }
    }
    // Outro aparelho conectou (ou o computador desconectou este): avisa para a página não tentar
    // voltar sozinha, o que faria dois celulares se derrubarem sem parar.
    if !stop.load(std::sync::atomic::Ordering::SeqCst) && !server.session_current(session) {
        let _ = socket.send(Message::Text(json!({ "type": "replaced" }).to_string()));
        let _ = socket.close(None);
        let _ = socket.flush();
    }
    server.session_closed(session);
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClientMessage {
    Trigger {
        source: String,
        layer: Option<u8>,
        // Pasta do botão do celular (0 é a página principal).
        #[serde(default)]
        page: u8,
        slot: u8,
        down: bool,
    },
    Ping,
    Sync,
}

// "/image/<pasta>/<slot>" → (pasta, slot).
fn image_route(route: &str) -> Option<(u8, u8)> {
    let (page, slot) = route.strip_prefix("/image/")?.split_once('/')?;
    Some((page.parse().ok()?, slot.parse().ok()?))
}

fn response(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8]) {
    send(stream, status, content_type, body, "no-store");
}

fn send(stream: &mut TcpStream, status: u16, content_type: &str, body: &[u8], cache: &str) {
    let reason = match status { 200 => "OK", 403 => "Forbidden", 404 => "Not Found", _ => "Error" };
    let header = format!("HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: {cache}\r\n\r\n", body.len());
    stream.write_all(header.as_bytes()).ok();
    stream.write_all(body).ok();
}

fn response_json(stream: &mut TcpStream, status: u16, body: &serde_json::Value) {
    let data = serde_json::to_vec(body).unwrap_or_default();
    response(stream, status, "application/json; charset=utf-8", &data);
}

fn local_urls(port: u16) -> Vec<String> {
    let mut addresses = BTreeSet::new();
    if let Ok(interfaces) = if_addrs::get_if_addrs() {
        for interface in interfaces {
            if let IfAddr::V4(address) = interface.addr {
                if !address.ip.is_loopback() && !address.ip.is_unspecified() && !address.ip.is_link_local() { addresses.insert(address.ip); }
            }
        }
    }
    let mut addresses: Vec<_> = addresses.into_iter().collect();
    // Redes domésticas primeiro: adaptadores virtuais (WSL, Hyper-V, VPN) costumam usar 172.x.
    addresses.sort_by_key(|address| match address.octets() { [192, 168, ..] => 0, [10, ..] => 1, [172, 16..=31, ..] => 2, _ => 3 });
    if addresses.is_empty() { return vec![format!("http://127.0.0.1:{port}/")]; }
    addresses.into_iter().map(|address| format!("http://{address}:{port}/")).collect()
}

fn qr_svg(value: &str) -> String {
    let Ok(qr) = QrCode::encode_text(value, QrCodeEcc::Medium) else { return String::new() };
    let border = 4;
    let size = qr.size();
    let total = size + border * 2;
    let mut svg = format!("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {total} {total}' shape-rendering='crispEdges'><rect width='100%' height='100%' fill='white'/>");
    for y in 0..size {
        for x in 0..size {
            if qr.get_module(x, y) { svg.push_str(&format!("<rect x='{}' y='{}' width='1' height='1' fill='black'/>", x + border, y + border)); }
        }
    }
    svg.push_str("</svg>");
    svg
}

fn mobile_page_html() -> String {
    MOBILE_PAGE.replacen(ICONS_MARKER, ICONS_JSON.trim(), 1)
}

// Botões de uma página do celular. Nas pastas o slot 1 fica com o "Voltar", desenhado pelo celular.
fn mobile_slots(buttons: &[MobileButton], page: u8) -> Vec<MobileSlot> {
    let mut slots: Vec<MobileSlot> = (1..=15).map(|slot| MobileSlot { slot, kind: "empty".into(), folder: 0, repeat: false, steps: Vec::new(), label: String::new(), icon: String::new(), color: String::new(), image: String::new(), fit: String::new(), executable: false, loaded: true }).collect();
    if page != 0 { slots[0].kind = "back".into(); }
    for button in buttons {
        if !(1..=15).contains(&button.slot) || (page != 0 && button.slot == 1) { continue; }
        let slot = &mut slots[button.slot as usize - 1];
        slot.folder = button.folder;
        slot.kind = if button.folder != 0 { "folder" } else if button.steps.is_empty() { "empty" } else { "app" }.into();
        slot.label = button.text.trim().to_string();
        slot.icon = if button.icon.is_empty() { auto_icon(button).into() } else { button.icon.clone() };
        slot.color = button.color.clone();
        if !button.image.is_empty() {
            // A versão no endereço muda com a imagem, então o celular pode guardar em cache.
            let mut hasher = DefaultHasher::new();
            button.image.hash(&mut hasher);
            slot.image = format!("/image/{page}/{}?v={:x}", button.slot, hasher.finish());
            slot.fit = if button.fit == "cover" { "cover" } else { "icon" }.into();
        }
        slot.executable = button.folder == 0 && !button.steps.is_empty();
        slot.repeat = slot.executable && button.mode == Mode::Normal && button.steps.iter().any(Step::is_incremental);
    }
    slots
}

// Ícone mostrado quando o usuário deixou "Auto": segue a primeira etapa, como no editor.
fn auto_icon(button: &MobileButton) -> &'static str {
    if button.folder != 0 { return "folder"; }
    if button.multi && button.steps.len() > 1 { return "multi"; }
    button.steps.first().map_or("", crate::states::step_icon)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pagina_mobile_tem_15_slots_estaveis() {
        let slots = mobile_slots(&[], 0);
        assert_eq!(slots.len(), 15);
        assert_eq!(slots.first().map(|slot| slot.slot), Some(1));
        assert_eq!(slots.last().map(|slot| slot.slot), Some(15));
    }

    #[test]
    fn pasta_reserva_o_botao_voltar_e_marca_pastas() {
        let folder = MobileButton { slot: 3, folder: 7, text: "Cenas".into(), icon: String::new(), color: String::new(), image: String::new(), fit: String::new(), multi: false, steps: Vec::new(), mode: Default::default(), alt: Vec::new(), profiles: Vec::new() };
        let slots = mobile_slots(&[folder], 2);
        assert_eq!(slots[0].kind, "back");
        assert_eq!(slots[2].kind, "folder");
        assert_eq!(slots[2].folder, 7);
        assert_eq!(slots[2].icon, "folder");
        assert!(!slots[2].executable);
    }

    #[test]
    fn acao_incremental_repete_e_etapas_do_espelho_nao_vao_ao_celular() {
        let volume = MobileButton { slot: 4, folder: 0, text: String::new(), icon: String::new(), color: String::new(), image: String::new(), fit: String::new(), multi: false, steps: vec![Step::Brightness { change: 10 }], mode: Mode::Normal, alt: Vec::new(), profiles: Vec::new() };
        let slots = mobile_slots(&[volume], 0);
        assert!(slots[3].repeat && slots[3].executable);
        assert_eq!(slots[3].icon, "sun");
        let mirrored: MobileSlot = serde_json::from_value(json!({ "slot": 1, "kind": "hid", "label": "", "icon": "", "color": "", "executable": true, "steps": [{ "type": "brightness", "change": 5 }] })).unwrap();
        assert_eq!(mirrored.steps.len(), 1);
        assert!(!serde_json::to_string(&mirrored).unwrap().contains("steps"));
    }

    #[test]
    fn imagem_do_botao_vira_endereco_com_versao() {
        // PNG de 1 × 1 pixel.
        let pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        assert!(decode_image(pixel).is_some_and(|(mime, bytes)| mime == "image/png" && !bytes.is_empty()));
        assert!(decode_image("data:image/svg+xml;base64,PHN2Zy8+").is_none());
        let button = MobileButton { slot: 2, folder: 0, text: String::new(), icon: String::new(), color: String::new(), image: pixel.into(), fit: "cover".into(), multi: false, steps: vec![Step::Delay { ms: 1 }], mode: Mode::Normal, alt: Vec::new(), profiles: Vec::new() };
        let slots = mobile_slots(&[button], 5);
        assert!(slots[1].image.starts_with("/image/5/2?v="));
        assert_eq!(slots[1].fit, "cover");
        assert_eq!(image_route("/image/5/2"), Some((5, 2)));
        assert_eq!(image_route("/image/x/2"), None);
        assert!(!serde_json::to_string(&slots[1]).unwrap().contains("base64"));
    }

    #[test]
    fn camadas_das_pastas_nao_colidem_com_o_macropad() {
        assert_eq!(mobile_page_of(mobile_layer(0)), Some(0));
        assert_eq!(mobile_page_of(mobile_layer(9)), Some(9));
        assert_eq!(mobile_page_of(1), None);
        assert_eq!(mobile_page_of(3), None);
    }

    #[test]
    fn pagina_recebe_os_icones_compartilhados() {
        assert!(MOBILE_PAGE.contains(ICONS_MARKER));
        let html = mobile_page_html();
        assert!(!html.contains(ICONS_MARKER));
        assert!(html.contains("\"brand\""));
    }

    #[test]
    fn arquivos_do_app_instalavel_existem() {
        for route in ["/manifest.webmanifest", "/sw.js", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"] {
            assert!(ASSETS.iter().any(|(asset, _, body)| *asset == route && !body.is_empty()), "{route}");
        }
        assert!(mobile_page_html().contains("manifest.webmanifest"));
    }

    #[test]
    fn qr_gera_svg_para_o_endereco() {
        let svg = qr_svg("http://192.168.1.2:38800/");
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("rect"));
    }

    #[test]
    fn enderecos_do_servidor_sao_http() {
        let urls = local_urls(38800);
        assert!(!urls.is_empty());
        assert!(urls.iter().all(|url| url.starts_with("http://")));
        assert!(urls.iter().all(|url| !url.starts_with("https://")));
    }

    #[test]
    #[allow(clippy::result_large_err)]
    fn websocket_permanece_aberto_apos_timeout_de_leitura() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let server = thread::spawn(move || {
            let stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(5)),
                    Err(error) => panic!("listener falhou: {error}"),
                }
            };
            prepare_connection(&stream).unwrap();
            let mut socket = accept_hdr(stream, |_: &Request, response: Response| Ok(response)).unwrap();
            assert_eq!(socket.read().unwrap().into_text().unwrap(), "auth");
            socket.send(Message::Text("state".into())).unwrap();
            socket.get_ref().set_read_timeout(Some(Duration::from_millis(70))).unwrap();
            assert!(matches!(socket.read(), Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)));
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                match socket.read() {
                    Ok(message) => { assert_eq!(message.into_text().unwrap(), "ping"); break; }
                    Err(tungstenite::Error::Io(error)) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) && Instant::now() < deadline => {}
                    Err(error) => panic!("WebSocket fechou antes do ping: {error}"),
                }
            }
            socket.send(Message::Text("pong".into())).unwrap();
        });
        let (mut client, _) = tungstenite::connect(format!("ws://{address}/ws")).unwrap();
        client.send(Message::Text("auth".into())).unwrap();
        assert_eq!(client.read().unwrap().into_text().unwrap(), "state");
        thread::sleep(Duration::from_millis(150));
        client.send(Message::Text("ping".into())).unwrap();
        assert_eq!(client.read().unwrap().into_text().unwrap(), "pong");
        server.join().unwrap();
    }

    #[test]
    fn conexao_nova_substitui_a_anterior_e_solta_as_teclas() {
        let mut control = Control::new();
        let (first, _) = mpsc::channel();
        let (session, released) = control.register_session(first);
        assert!(released.is_empty());
        control.pressed.insert((0, 3));
        let (second, _) = mpsc::channel();
        let (next, released) = control.register_session(second);
        assert_ne!(next, session);
        assert_eq!(released, HashSet::from([(0, 3)]));
        assert!(control.connected && control.pressed.is_empty());
    }

    #[test]
    fn imagem_trocada_muda_o_endereco_no_celular() {
        let png = |pixel: &str| format!("data:image/png;base64,{pixel}");
        let button = |image: String| MobileButton { slot: 1, folder: 0, text: String::new(), icon: String::new(), color: String::new(), image, fit: "icon".into(), multi: false, steps: vec![Step::Delay { ms: 1 }], mode: Mode::Normal, alt: Vec::new(), profiles: Vec::new() };
        let first = mobile_slots(&[button(png("AAAA"))], 0);
        let second = mobile_slots(&[button(png("BBBB"))], 0);
        assert_ne!(first[0].image, second[0].image);
    }
}
