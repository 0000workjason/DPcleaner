//! Tauri shell for dpcleaner.
//!
//! Spawns the Python engine as a sidecar, captures the `DPC_READY port=.. token=..`
//! handshake it prints, exposes that to the webview via the `backend_info` command,
//! and kills the child when the app exits.
//!
//! Dev (`debug_assertions`): runs the engine's venv Python against the source tree.
//! Release: runs the PyInstaller-built `dpcleaner-server.exe` next to the app exe.

use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, RunEvent, State};

#[derive(Clone, Serialize)]
struct BackendInfo {
    port: u16,
    token: String,
}

#[derive(Default)]
struct AppState {
    backend: Mutex<Option<BackendInfo>>,
    child: Mutex<Option<Child>>,
}

/// The webview polls this until it returns the backend's port + token.
#[tauri::command]
fn backend_info(state: State<AppState>) -> Option<BackendInfo> {
    state.backend.lock().unwrap().clone()
}

fn backend_command() -> Command {
    if cfg!(debug_assertions) {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let py = format!("{manifest}/../backend/.venv/Scripts/python.exe");
        let script = format!("{manifest}/../backend/server_main.py");
        let mut cmd = Command::new(py);
        cmd.arg(script);
        cmd
    } else {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_default();
        Command::new(exe_dir.join("dpcleaner-server.exe"))
    }
}

/// Start the backend and block (in the caller's thread) until it prints its
/// handshake line, then keep draining its stdout so the pipe never blocks it.
fn spawn_backend() -> Option<(Child, BackendInfo)> {
    let mut cmd = backend_command();
    cmd.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("dpcleaner: failed to spawn backend: {e}");
            return None;
        }
    };
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<BackendInfo>();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut sent = false;
        for line in reader.lines().map_while(Result::ok) {
            if !sent {
                if let Some(rest) = line.strip_prefix("DPC_READY ") {
                    let mut port = 0u16;
                    let mut token = String::new();
                    for tok in rest.split_whitespace() {
                        if let Some(p) = tok.strip_prefix("port=") {
                            port = p.parse().unwrap_or(0);
                        } else if let Some(t) = tok.strip_prefix("token=") {
                            token = t.to_string();
                        }
                    }
                    let _ = tx.send(BackendInfo { port, token });
                    sent = true;
                }
            }
            // keep looping to drain remaining stdout
        }
    });

    // Generous: first run imports torch and may download the model.
    let info = rx.recv_timeout(Duration::from_secs(120)).ok()?;
    Some((child, info))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![backend_info])
        .setup(|app| {
            // Start the engine off the UI thread so the window paints immediately;
            // the frontend shows a "starting engine" splash while it polls.
            let handle = app.handle().clone();
            thread::spawn(move || {
                if let Some((child, info)) = spawn_backend() {
                    let state = handle.state::<AppState>();
                    *state.backend.lock().unwrap() = Some(info);
                    *state.child.lock().unwrap() = Some(child);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                let child = state.child.lock().unwrap().take(); // drop guard here
                if let Some(mut child) = child {
                    let _ = child.kill();
                }
            }
        });
}
