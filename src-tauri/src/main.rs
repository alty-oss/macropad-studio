// Macropad Studio: janela de configuração, ícone na bandeja e executor das ações do macropad.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod config;
mod device;
mod device_watch;
mod device_input;
mod executor;
mod integrations;
mod mobile;
mod obs;
mod secrets;
mod system;
mod virtual_keys;

use config::{mobile_page_of, Config, Label, Macro, MobilePage, Settings, Step, MOBILE_MAX_FOLDER};
use device::Hid;
use device_input::DeviceInput;
use executor::{Job, Outcome};
use obs::{Obs, ObsStatus};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const HIDDEN_ARG: &str = "--hidden";
const ELEVATED_RELAUNCH_ARG: &str = "--macropad-elevated-relaunch";
const OBS_SECRET: &str = "obs";
const LOG_LIMIT: u64 = 1024 * 1024;

struct AppState {
    hid: Mutex<Hid>,
    config: Mutex<Config>,
    config_path: PathBuf,
    config_problem: Mutex<Option<String>>,
    log_path: PathBuf,
    jobs: Mutex<mpsc::Sender<Job>>,
    obs: &'static Obs,
    // Última camada de onde veio uma ação do macropad: é a camada ativa no aparelho.
    detected_layer: Mutex<Option<u8>>,
    mobile: Arc<mobile::MobileServer>,
}

struct Tray {
    autostart: CheckMenuItem<Wry>,
    paused: CheckMenuItem<Wry>,
}

fn state(app: &AppHandle) -> State<'_, AppState> {
    app.state::<AppState>()
}

fn save_config(state: &AppState, config: &Config) -> Result<(), String> {
    config.save(&state.config_path)
}

// Registro de atividade em arquivo, para suporte. Passando de 1 MB, o arquivo vira .old.
fn append_log(path: &PathBuf, line: &str) {
    if fs::metadata(path).is_ok_and(|meta| meta.len() > LOG_LIMIT) {
        fs::rename(path, path.with_extension("old.log")).ok();
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).ok();
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let seconds = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let (date, time) = system::local_date_time();
        writeln!(file, "{date} {time} [{seconds}] {line}").ok();
    }
}

fn main_visible(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .is_some_and(|window| window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false))
}

// Erros e avisos: na janela, se ela estiver aberta; senão, como notificação do Windows.
fn alert(app: &AppHandle, text: &str) {
    append_log(&state(app).log_path, text);
    app.emit("macro-error", text).ok();
    if !main_visible(app) {
        app.notification().builder().title("Macropad Studio").body(text).show().ok();
    }
}

#[derive(Clone, Serialize)]
struct Osd {
    title: String,
    detail: String,
    tone: &'static str,
}

fn show_osd(app: &AppHandle, osd: Osd) {
    if let Some(window) = app.get_webview_window("osd") {
        window.emit("osd", osd).ok();
    }
}

fn update_tray_tooltip(app: &AppHandle) {
    // O OBS pode avisar antes de o estado do app ser registrado, logo na abertura.
    let Some(state) = app.try_state::<AppState>() else { return };
    let mut parts = vec!["Macropad Studio".to_string()];
    if let Some(layer) = *state.detected_layer.lock().unwrap() {
        parts.push(format!("Camada {layer}"));
    }
    let obs = state.obs.status();
    if obs.recording {
        parts.push("● Gravando".into());
    }
    if obs.streaming {
        parts.push("● Ao vivo".into());
    }
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(parts.join(" · "))).ok();
    }
}

struct AppHost(AppHandle);

impl executor::Host for AppHost {
    fn lookup(&self, layer: u8, slot: u8) -> Option<Macro> {
        let app_state = state(&self.0);
        let config = app_state.config.lock().unwrap();
        if let Some(page) = mobile_page_of(layer) {
            return config.mobile.button(page, slot).filter(|item| item.folder == 0).map(|item| item.as_macro(layer));
        }
        config.macros.iter().find(|item| item.layer == layer && item.slot == slot).cloned()
    }

    fn obs(&self) -> &'static Obs {
        state(&self.0).obs
    }

    fn pressed(&self, layer: u8, slot: u8, down: bool) {
        // Cada ação recebida fica no log: é o primeiro lugar para olhar quando uma ação do app não
        // faz nada (o macropad chegou? a ação rodou?).
        let mobile = mobile_page_of(layer).is_some();
        let source = if mobile { "celular" } else { "macropad" };
        append_log(&state(&self.0).log_path, &format!("Entrada do {source}: camada {layer}, slot {slot} ({})", if down { "desce" } else { "sobe" }));
        state(&self.0).mobile.broadcast_fired(layer, slot, down);
        if !down {
            return;
        }
        if mobile {
            return;
        }
        self.0.emit("macro-fired", (layer, slot)).ok();
        let changed = state(&self.0).detected_layer.lock().unwrap().replace(layer) != Some(layer);
        if changed {
            state(&self.0).mobile.set_detected_layer(Some(layer));
            update_tray_tooltip(&self.0);
            let enabled = state(&self.0).config.lock().unwrap().settings.osd;
            if enabled {
                show_osd(&self.0, Osd { title: format!("Camada {layer}"), detail: "Ativa no macropad".into(), tone: "info" });
            }
        }
    }

    fn report(&self, origin: Option<(u8, u8)>, steps: &[Step], outcome: Outcome) {
        let app = &self.0;
        if let Some((layer, slot)) = origin {
            let result = outcome.error.as_deref().map_or_else(|| "concluída".to_string(), |error| format!("falhou: {error}"));
            append_log(&state(app).log_path, &format!("Ação da {} {}, slot {} ({} etapas): {result}", if mobile_page_of(layer).is_some() { "página mobile" } else { "camada" }, layer, slot, steps.len()));
        }
        for warning in &outcome.warnings {
            alert(app, warning);
        }
        if let Some(error) = &outcome.error {
            alert(app, error);
        }
        let Some((layer, slot)) = origin else { return };
        let state = state(app);
        let config = state.config.lock().unwrap();
        if !config.settings.osd {
            return;
        }
        let label = if let Some(page) = mobile_page_of(layer) {
            config.mobile.button(page, slot).map(|button| button.text.trim().to_string()).filter(|text| !text.is_empty())
        } else {
            config.labels.iter().find(|label| label.layer == layer && label.slot == slot).map(|label| label.text.trim().to_string()).filter(|text| !text.is_empty())
        };
        drop(config);
        let title = label.or_else(|| steps.first().map(executor::describe)).unwrap_or_default();
        let (detail, tone) = match (&outcome.error, outcome.feedback.last()) {
            (Some(error), _) => (error.clone(), "error"),
            (None, Some(feedback)) => (feedback.clone(), "info"),
            (None, None) => (String::new(), "info"),
        };
        show_osd(app, Osd { title, detail, tone });
    }
}

#[tauri::command(async)]
fn device_connect(state: State<AppState>) -> Result<(), String> {
    state.hid.lock().unwrap().open()
}

#[tauri::command(async)]
fn device_send(state: State<AppState>, payload: Vec<u8>) -> Result<(), String> {
    state.hid.lock().unwrap().send(&payload)
}

#[tauri::command(async)]
fn device_ask(state: State<AppState>, payload: Vec<u8>, expected: usize, timeout_ms: u64) -> Result<Vec<Vec<u8>>, String> {
    state.hid.lock().unwrap().ask(&payload, expected, Duration::from_millis(timeout_ms.min(10_000)))
}

#[tauri::command]
fn macros_get(state: State<AppState>) -> Vec<Macro> {
    state.config.lock().unwrap().macros.clone()
}

#[tauri::command]
fn macros_save(state: State<AppState>, macros: Vec<Macro>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    let previous = std::mem::replace(&mut config.macros, macros);
    if let Err(error) = save_config(&state, &config) {
        config.macros = previous;
        return Err(error);
    }
    virtual_keys::set_routes(&config.macros);
    Ok(())
}

// Aviso de configuração ilegível na abertura (config.rs). Entregue uma vez só.
#[tauri::command]
fn config_problem(state: State<AppState>) -> Option<String> {
    state.config_problem.lock().unwrap().take()
}

#[tauri::command]
fn labels_get(state: State<AppState>) -> Vec<Label> {
    state.config.lock().unwrap().labels.clone()
}

#[tauri::command]
fn labels_save(state: State<AppState>, labels: Vec<Label>) -> Result<(), String> {
    let mut config = state.config.lock().unwrap();
    config.labels = labels;
    save_config(&state, &config)
}

#[derive(Serialize)]
struct SettingsView {
    settings: Settings,
    obs_password: bool,
}

#[tauri::command]
fn settings_get(state: State<AppState>) -> SettingsView {
    SettingsView {
        settings: state.config.lock().unwrap().settings.clone(),
        obs_password: secrets::read(OBS_SECRET).is_some(),
    }
}

#[tauri::command]
fn mobile_status(state: State<AppState>) -> mobile::MobileStatus {
    state.mobile.status()
}

#[tauri::command]
fn mobile_disconnect(state: State<AppState>) {
    state.mobile.disconnect();
}

fn validate_mobile_page(page: &MobilePage) -> Result<(), String> {
    let mut folders = std::collections::HashSet::new();
    for folder in &page.folders {
        if !(1..=MOBILE_MAX_FOLDER).contains(&folder.id) { return Err(format!("A pasta {} tem um identificador inválido.", folder.id)); }
        if !folders.insert(folder.id) { return Err(format!("A pasta {} está repetida.", folder.id)); }
        if folder.name.chars().count() > 48 { return Err(format!("O nome da pasta {} é muito longo.", folder.id)); }
    }
    let pages = std::iter::once((0, &page.buttons)).chain(page.folders.iter().map(|folder| (folder.id, &folder.buttons)));
    for (id, buttons) in pages {
        validate_mobile_buttons(id, buttons, &folders)?;
    }
    Ok(())
}

fn validate_mobile_buttons(page: u8, buttons: &[config::MobileButton], folders: &std::collections::HashSet<u8>) -> Result<(), String> {
    let mut slots = std::collections::HashSet::new();
    // Nas pastas, o botão 1 é o "Voltar".
    let first = if page == 0 { 1 } else { 2 };
    for button in buttons {
        if !(first..=15).contains(&button.slot) { return Err(format!("O botão mobile deve estar entre {first} e 15.")); }
        if !slots.insert(button.slot) { return Err(format!("O botão mobile {} está repetido.", button.slot)); }
        if button.folder != 0 && !folders.contains(&button.folder) { return Err(format!("O botão {} abre uma pasta que não existe.", button.slot)); }
        if button.folder != 0 && !button.steps.is_empty() { return Err(format!("O botão {} é uma pasta e não pode ter etapas.", button.slot)); }
        if button.text.chars().count() > 48 { return Err(format!("A legenda do botão {} é muito longa.", button.slot)); }
        if !button.color.is_empty() && !button.color.starts_with('#') { return Err(format!("A cor do botão {} é inválida.", button.slot)); }
        if !button.image.is_empty() && config::decode_image(&button.image).is_none() { return Err(format!("A imagem do botão {} é inválida ou grande demais.", button.slot)); }
        if !matches!(button.fit.as_str(), "" | "icon" | "cover") { return Err(format!("O ajuste da imagem do botão {} é inválido.", button.slot)); }
    }
    Ok(())
}

#[tauri::command]
fn mobile_page_get(state: State<AppState>) -> MobilePage {
    state.config.lock().unwrap().mobile.clone()
}

#[tauri::command(async)]
fn mobile_page_save(app: AppHandle, page: MobilePage) -> Result<(), String> {
    validate_mobile_page(&page)?;
    let state = state(&app);
    let previous = {
        let mut config = state.config.lock().unwrap();
        let previous = config.mobile.clone();
        config.mobile = page.clone();
        if let Err(error) = save_config(&state, &config) {
            config.mobile = previous.clone();
            return Err(error);
        }
        previous
    };
    state.mobile.set_mobile_page(&page);
    let _ = previous;
    Ok(())
}

#[tauri::command]
fn mobile_mirror_sync(state: State<AppState>, mirror: mobile::MobileMirror) {
    if let Some(layer) = mirror.detected_layer.filter(|layer| (1..=3).contains(layer)) {
        *state.detected_layer.lock().unwrap() = Some(layer);
    }
    state.mobile.sync_mirror(mirror);
}

// Senha e token: None mantém o que está guardado; texto vazio apaga. Assíncrono porque pode criar
// a janela do OSD, e criar janelas num comando síncrono trava o Windows.
#[tauri::command(async)]
fn settings_save(app: AppHandle, settings: Settings, obs_password: Option<String>) -> Result<(), String> {
    let state = state(&app);
    if let Some(password) = obs_password {
        secrets::write(OBS_SECRET, &password)?;
    }
    let previous = {
        let mut config = state.config.lock().unwrap();
        let previous = config.settings.clone();
        config.settings = settings.clone();
        if let Err(error) = save_config(&state, &config) {
            config.settings = previous.clone();
            return Err(error);
        }
        previous
    };
    if let Err(error) = state.mobile.configure(settings.mobile.clone()) {
        let mut config = state.config.lock().unwrap();
        let old_mobile = previous.mobile.clone();
        config.settings = previous;
        save_config(&state, &config).ok();
        state.mobile.configure(old_mobile).ok();
        return Err(error);
    }
    state.obs.configure(settings.obs, secrets::read(OBS_SECRET).unwrap_or_default());
    system::set_sound_volume(settings.sound_volume);
    set_osd(&app, settings.osd);
    if settings.always_admin && !system::is_elevated() {
        system::relaunch_as_admin(&std::env::args().collect::<Vec<_>>())?;
        app.exit(0);
    }
    Ok(())
}

#[tauri::command]
fn layer_detected(app: AppHandle, layer: u8) {
    if !(1..=3).contains(&layer) {
        return;
    }
    state(&app).detected_layer.lock().unwrap().replace(layer);
    state(&app).mobile.set_detected_layer(Some(layer));
    if state(&app).config.lock().unwrap().settings.osd {
        show_osd(&app, Osd { title: format!("Camada {layer}"), detail: "Ativa no macropad".into(), tone: "info" });
    }
}

#[tauri::command]
fn obs_status(state: State<AppState>) -> ObsStatus {
    state.obs.status()
}

#[derive(Serialize)]
struct ObsLists {
    scenes: Vec<String>,
    inputs: Vec<String>,
}

#[tauri::command(async)]
fn obs_lists(state: State<AppState>) -> Result<ObsLists, String> {
    Ok(ObsLists { scenes: state.obs.scenes()?, inputs: state.obs.inputs()? })
}

#[tauri::command(async)]
fn obs_scene_sources(state: State<AppState>, scene: String) -> Result<Vec<String>, String> {
    state.obs.scene_sources(&scene)
}


// Programas com janela aberta agora, para escolher o perfil de uma ação.
#[tauri::command]
fn running_apps() -> Vec<String> {
    let mut apps = system::window_apps();
    apps.sort();
    apps.dedup();
    apps
}

#[tauri::command]
fn macro_test(state: State<AppState>, steps: Vec<Step>) -> Result<(), String> {
    state.jobs.lock().unwrap().send(Job::Run(steps)).map_err(|e| e.to_string())
}

#[tauri::command]
fn macros_stop() {
    executor::cancel_all();
}

#[tauri::command]
fn keys_paused_get() -> bool {
    virtual_keys::paused()
}

#[tauri::command]
fn keys_paused_set(app: AppHandle, paused: bool) {
    set_paused(&app, paused);
}

fn set_paused(app: &AppHandle, paused: bool) {
    virtual_keys::set_paused(paused);
    if let Some(tray) = app.try_state::<Tray>() {
        tray.paused.set_checked(paused).ok();
    }
    app.emit("keys-paused", paused).ok();
}

#[tauri::command]
fn log_append(state: State<AppState>, line: String) {
    append_log(&state.log_path, &line);
}

#[tauri::command]
fn logs_open(state: State<AppState>) -> Result<(), String> {
    let dir = state.log_path.parent().ok_or("Pasta de logs indisponível.")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn pick_path(app: AppHandle, folder: bool, save: Option<bool>) -> Option<String> {
    let dialog = app.dialog().file();
    let picked = if folder {
        dialog.blocking_pick_folder()
    } else if save.unwrap_or(false) {
        dialog.blocking_save_file()
    } else {
        dialog.blocking_pick_file()
    };
    picked.map(|path| path.to_string())
}

const BACKUP_FILTER: &str = "Configuração do Macropad Studio";

// Salva um arquivo gerado pela interface (exportação, cola da configuração). false se cancelar.
#[tauri::command(async)]
fn file_save(app: AppHandle, contents: String, file_name: String, filter: Option<String>, extension: Option<String>) -> Result<bool, String> {
    let filter = filter.unwrap_or_else(|| BACKUP_FILTER.into());
    let extension = extension.unwrap_or_else(|| "json".into());
    let picked = app.dialog().file().add_filter(&filter, &[extension.as_str()]).set_file_name(file_name).blocking_save_file();
    let Some(path) = picked else { return Ok(false) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| format!("Não foi possível salvar o arquivo: {e}"))?;
    Ok(true)
}

// Importa uma configuração: pergunta qual arquivo abrir e devolve o texto, ou None se cancelar.
#[tauri::command(async)]
fn backup_open(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().add_filter(BACKUP_FILTER, &["json"]).blocking_pick_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    fs::read_to_string(path).map(Some).map_err(|e| format!("Não foi possível ler o arquivo: {e}"))
}

// Tipo do caminho de uma etapa "Abrir", para a interface avisar sobre erros de digitação.
#[tauri::command]
fn path_kind(path: String) -> &'static str {
    match fs::metadata(path.trim()) {
        Ok(metadata) if metadata.is_dir() => "dir",
        Ok(_) => "file",
        Err(_) => "missing",
    }
}

#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    notes: String,
}

// Atualizações: o latest.json do último release no GitHub, assinado com a chave do updater.
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| format!("Não foi possível procurar atualizações: {e}"))?;
    Ok(update.map(|update| UpdateInfo { version: update.version.clone(), notes: update.body.clone().unwrap_or_default() }))
}

// Baixa e instala a atualização; o instalador fecha o app e o abre de novo na versão nova.
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else { return Err("O Macropad Studio já está na versão mais nova.".into()) };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| format!("Não foi possível instalar a atualização: {e}"))?;
    app.restart();
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_autostart(&app, enabled)
}

fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    result.map_err(|e| e.to_string())?;
    if let Some(tray) = app.try_state::<Tray>() {
        tray.autostart.set_checked(enabled).ok();
    }
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.unminimize().ok();
        window.set_focus().ok();
    }
}

// Janela do OSD: transparente, sempre no topo, sem foco e sem receber cliques. Fica aberta o
// tempo todo (mostrar e esconder roubaria o foco); a página só aparece quando há aviso.
fn set_osd(app: &AppHandle, enabled: bool) {
    let existing = app.get_webview_window("osd");
    if !enabled {
        if let Some(window) = existing {
            window.destroy().ok();
        }
        return;
    }
    if existing.is_some() {
        return;
    }
    let (width, height) = (360.0, 96.0);
    let built = WebviewWindowBuilder::new(app, "osd", WebviewUrl::App("osd.html".into()))
        .title("Macropad Studio OSD")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build();
    let Ok(window) = built else { return };
    // Embaixo, no centro do monitor principal, acima da barra de tarefas.
    if let Ok(Some(monitor)) = window.primary_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        window.set_position(tauri::LogicalPosition::new(origin.x + (size.width - width) / 2.0, origin.y + size.height - height - 96.0)).ok();
    }
    window.set_ignore_cursor_events(true).ok();
    system::show_without_focus(&window);
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let autostart = CheckMenuItem::with_id(app, "autostart", "Iniciar com o Windows", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
    let paused = CheckMenuItem::with_id(app, "pause", "Pausar teclas virtuais", true, false, None::<&str>)?;
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "open", "Abrir Macropad Studio", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "stop", "Parar ações em execução", true, None::<&str>)?,
        &paused,
        &PredefinedMenuItem::separator(app)?,
        &autostart,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?,
    ])?;
    let (autostart_item, paused_item) = (autostart.clone(), paused.clone());
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("ícone do app ausente"))
        .tooltip("Macropad Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "stop" => executor::cancel_all(),
            "pause" => set_paused(app, paused_item.is_checked().unwrap_or(false)),
            "autostart" => {
                set_autostart(app, autostart_item.is_checked().unwrap_or(false)).ok();
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    app.manage(Tray { autostart, paused });
    Ok(())
}

fn emit_device_state(app: &AppHandle) {
    let app_state = state(app);
    let Some(mut hid) = app_state.hid.try_lock().ok() else {
        let retry = app.clone();
        thread::spawn(move || {
            for _ in 0..5 {
                thread::sleep(Duration::from_millis(50));
                let app_state = state(&retry);
                let present = app_state.hid.try_lock().ok().map(|mut hid| hid.present());
                if let Some(present) = present {
                    retry.emit("device-changed", present).ok();
                    if let Some(state) = retry.try_state::<AppState>() { state.mobile.set_device_present(present); }
                    return;
                }
            }
        });
        return;
    };
    let present = hid.present();
    app.emit("device-changed", present).ok();
    app.state::<AppState>().mobile.set_device_present(present);
}

fn spawn_device_watch(app: AppHandle) {
    device_watch::start(move || emit_device_state(&app));
}

// Linha de comando: "--run 1:3" aciona a camada 1, slot 3, como se a tecla fosse pressionada;
// "--stop" para as ações em execução. Chega aqui também pela segunda instância.
fn handle_cli(app: &AppHandle, args: &[String]) -> bool {
    if args.iter().any(|arg| arg == "--stop") {
        executor::cancel_all();
        return true;
    }
    let Some(target) = args.iter().position(|arg| arg == "--run").and_then(|index| args.get(index + 1)) else { return false };
    let parsed = target.split_once(':').and_then(|(layer, slot)| Some((layer.trim().parse::<u8>().ok()?, slot.trim().parse::<u8>().ok()?)));
    match parsed {
        Some((layer, slot)) => {
            let jobs = state(app).jobs.lock().unwrap().clone();
            jobs.send(Job::Key(layer, slot, true)).ok();
            jobs.send(Job::Key(layer, slot, false)).ok();
        }
        None => alert(app, &format!("Uso: --run <camada>:<slot>, por exemplo --run 1:3 (recebido: {target}).")),
    }
    true
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !handle_cli(app, &args) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let log_path = app.path().app_log_dir()?.join("activity.log");
            let (config, problem) = Config::load(&config_path);
            if let Some(problem) = &problem {
                append_log(&log_path, problem);
            }
            if config.settings.always_admin && !system::is_elevated() && !std::env::args().any(|arg| arg == ELEVATED_RELAUNCH_ARG) {
                match system::relaunch_as_admin(&std::env::args().collect::<Vec<_>>()) {
                    Ok(()) => {
                        app.handle().exit(0);
                        return Ok(());
                    }
                    Err(error) => append_log(&log_path, &format!("Elevação automática: {error}")),
                }
            }
            let handle = app.handle().clone();
            let obs = Obs::start(config.settings.obs.clone(), secrets::read(OBS_SECRET).unwrap_or_default(), move |status| {
                handle.emit("obs-state", status).ok();
                update_tray_tooltip(&handle);
            });
            let host = Arc::new(AppHost(app.handle().clone()));
            let jobs = executor::spawn(host);
            let fired = Mutex::new(jobs.clone());
            let osd = config.settings.osd;
            let mobile_settings = config.settings.mobile.clone();
            let mobile_page = config.mobile.clone();
            let mobile_server = mobile::MobileServer::new(app.handle().clone());
            system::set_sound_volume(config.settings.sound_volume);
            virtual_keys::set_routes(&config.macros);
            app.manage(AppState {
                hid: Mutex::new(Hid::new()),
                config: Mutex::new(config),
                config_path,
                config_problem: Mutex::new(problem.clone()),
                log_path,
                jobs: Mutex::new(jobs),
                obs,
                detected_layer: Mutex::new(None),
                mobile: mobile_server.clone(),
            });
            mobile_server.set_mobile_page(&mobile_page);
            if let Err(error) = mobile_server.configure(mobile_settings) {
                append_log(&app.path().app_log_dir()?.join("activity.log"), &format!("Servidor mobile: {error}"));
            }
            // O Raw Input identifica o macropad, executa as ações do app e também alimenta o preview.
            let input_app = app.handle().clone();
            virtual_keys::start_filter();
            device_input::start(move |input| {
                if let DeviceInput::Key { mods, code, down } = &input {
                    virtual_keys::observe_device_key(*mods, *code, *down);
                    if !virtual_keys::paused() {
                        if let Some((layer, slot)) = virtual_keys::route_for(*mods, *code) {
                            fired.lock().unwrap().send(Job::Key(layer, slot, *down)).ok();
                        }
                    }
                }
                input_app.emit_to("main", "device-input", input).ok();
            });
            spawn_device_watch(app.handle().clone());
            build_tray(app)?;
            set_osd(app.handle(), osd);
            let args: Vec<String> = std::env::args().collect();
            let from_cli = handle_cli(app.handle(), &args);
            if !from_cli && !args.iter().any(|arg| arg == HIDDEN_ARG) {
                show_main(app.handle());
            } else if let Some(problem) = problem {
                app.notification().builder().title("Macropad Studio").body(problem).show().ok();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar a janela só a esconde: as teclas virtuais continuam ativas na bandeja.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    window.hide().ok();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            device_connect,
            device_send,
            device_ask,
            macros_get,
            macros_save,
            config_problem,
            labels_get,
            labels_save,
            settings_get,
            settings_save,
            mobile_status,
            mobile_disconnect,
            mobile_page_get,
            mobile_page_save,
            mobile_mirror_sync,
            layer_detected,
            obs_status,
            obs_lists,
            obs_scene_sources,
            running_apps,
            macro_test,
            macros_stop,
            keys_paused_get,
            keys_paused_set,
            log_append,
            logs_open,
            pick_path,
            path_kind,
            file_save,
            backup_open,
            app_version,
            update_check,
            update_install,
            autostart_get,
            autostart_set
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Macropad Studio");
}
