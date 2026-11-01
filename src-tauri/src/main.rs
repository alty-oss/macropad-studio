// Macropad Studio: janela de configuração, ícone na bandeja e executor das teclas virtuais.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod config;
mod device;
mod hook;

use config::{Config, Macro, Step};
use device::Hid;
use std::{
    path::PathBuf,
    sync::{mpsc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent, Wry,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_dialog::DialogExt;

const HIDDEN_ARG: &str = "--hidden";

enum Job {
    Fired(u8, u8),
    Run(Vec<Step>),
}

struct AppState {
    hid: Mutex<Hid>,
    config: Mutex<Config>,
    config_path: PathBuf,
    jobs: Mutex<mpsc::Sender<Job>>,
}

struct TrayAutostart(CheckMenuItem<Wry>);

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
    config.macros = macros;
    config.save(&state.config_path)?;
    hook::set_routes(&config.macros);
    Ok(())
}

#[tauri::command]
fn macro_test(state: State<AppState>, steps: Vec<Step>) -> Result<(), String> {
    state.jobs.lock().unwrap().send(Job::Run(steps)).map_err(|e| e.to_string())
}

#[tauri::command(async)]
fn pick_path(app: AppHandle, folder: bool) -> Option<String> {
    let dialog = app.dialog().file();
    let picked = if folder { dialog.blocking_pick_folder() } else { dialog.blocking_pick_file() };
    picked.map(|path| path.to_string())
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
    if let Some(item) = app.try_state::<TrayAutostart>() {
        item.0.set_checked(enabled).ok();
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

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let autostart = CheckMenuItem::with_id(app, "autostart", "Iniciar com o Windows", true, app.autolaunch().is_enabled().unwrap_or(false), None::<&str>)?;
    let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "open", "Abrir Macropad Studio", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &autostart,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?,
    ])?;
    let toggle = autostart.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("ícone do app ausente"))
        .tooltip("Macropad Studio")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "autostart" => {
                set_autostart(app, toggle.is_checked().unwrap_or(false)).ok();
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
    app.manage(TrayAutostart(autostart));
    Ok(())
}

// As ações rodam numa thread própria: o gancho de teclado precisa responder na hora.
fn spawn_executor(app: AppHandle, queue: mpsc::Receiver<Job>) {
    thread::spawn(move || {
        actions::init_thread();
        for job in queue {
            let (steps, from_device) = match job {
                Job::Fired(layer, slot) => {
                    app.emit("macro-fired", (layer, slot)).ok();
                    let state = app.state::<AppState>();
                    let config = state.config.lock().unwrap();
                    let steps = config.macros.iter().find(|item| item.layer == layer && item.slot == slot).map(|item| item.steps.clone());
                    (steps.unwrap_or_default(), true)
                }
                Job::Run(steps) => (steps, false),
            };
            if let Err(error) = actions::run(&steps, from_device) {
                app.emit("macro-error", error).ok();
            }
        }
    });
}

fn spawn_device_watch(app: AppHandle) {
    thread::spawn(move || {
        let mut last = None;
        loop {
            let present = app.state::<AppState>().hid.lock().unwrap().present();
            if last != Some(present) {
                app.emit("device-changed", present).ok();
                last = Some(present);
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![HIDDEN_ARG])))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let config = Config::load(&config_path);
            let (jobs, queue) = mpsc::channel();
            let fired = Mutex::new(jobs.clone());
            hook::start(move |layer, slot| {
                fired.lock().unwrap().send(Job::Fired(layer, slot)).ok();
            });
            hook::set_routes(&config.macros);
            app.manage(AppState { hid: Mutex::new(Hid::new()), config: Mutex::new(config), config_path, jobs: Mutex::new(jobs) });
            spawn_executor(app.handle().clone(), queue);
            spawn_device_watch(app.handle().clone());
            build_tray(app)?;
            if !std::env::args().any(|arg| arg == HIDDEN_ARG) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fechar a janela só a esconde: as teclas virtuais continuam ativas na bandeja.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window.hide().ok();
            }
        })
        .invoke_handler(tauri::generate_handler![
            device_connect,
            device_send,
            device_ask,
            macros_get,
            macros_save,
            macro_test,
            pick_path,
            autostart_get,
            autostart_set
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Macropad Studio");
}
