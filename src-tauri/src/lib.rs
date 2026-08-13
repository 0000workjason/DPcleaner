//! Tauri shell for dpcleaner.
//!
//! Spawns the Python engine as a sidecar, captures the `DPC_READY port=.. token=..`
//! handshake it prints, exposes that to the webview via the `backend_info` command,
//! and kills the child when the app exits.
//!
//! Dev (`debug_assertions`): runs the engine's venv Python against the source tree.
//! Release: runs the PyInstaller-built `dpcleaner-server.exe` next to the app exe.

use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone, Serialize)]
struct BackendInfo {
    port: u16,
    token: String,
}

#[derive(Default)]
struct AppState {
    backend: Mutex<Option<BackendInfo>>,
    child: Mutex<Option<Child>>,
    error: Mutex<Option<String>>,
}

/// The webview polls this until it returns the backend's port + token.
#[tauri::command]
fn backend_info(state: State<AppState>) -> Option<BackendInfo> {
    state.backend.lock().unwrap().clone()
}

/// Set when the engine failed to start. Without it the webview cannot tell
/// "not ready yet" from "never coming", so a failure known in 200ms used to
/// spin the splash for the full two-minute poll timeout and the Retry button
/// could never succeed.
#[tauri::command]
fn backend_error(state: State<AppState>) -> Option<String> {
    state.error.lock().unwrap().clone()
}

/// Windows job object owning the backend process.
///
/// `RunEvent::Exit` only fires on a graceful exit -- not on Task Manager "End
/// task", not on a panic, and not while startup is still on its own thread. A
/// job with `KILL_ON_JOB_CLOSE` makes the kernel tear the tree down whenever
/// this process dies, however it dies. It also covers the release sidecar,
/// which is a PyInstaller onefile: two processes (bootloader + the real
/// server), where killing our `Child` handle alone leaves the server running.
#[cfg(windows)]
mod job {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use std::sync::OnceLock;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::core::PCWSTR;

    struct Job(HANDLE);
    // Never closed explicitly: the handle lives for the process lifetime, and
    // the OS closing it on exit is exactly what kills the job.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    fn create() -> Option<Job> {
        unsafe {
            let handle = CreateJobObjectW(None, PCWSTR::null()).ok()?;
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
            .ok()?;
            Some(Job(handle))
        }
    }

    /// Put `child` -- and anything it spawns -- under the job. Best effort: on
    /// failure we still have the explicit kill on `RunEvent::Exit`.
    pub fn adopt(child: &Child) {
        let Some(job) = JOB.get_or_init(create) else {
            eprintln!("dpcleaner: could not create job object; backend may outlive a force-kill");
            return;
        };
        let handle = HANDLE(child.as_raw_handle() as _);
        if let Err(e) = unsafe { AssignProcessToJobObject(job.0, handle) } {
            eprintln!("dpcleaner: could not put backend in job object: {e}");
        }
    }
}

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default()
}

/// Portable mode: a `portable.txt` next to the executable means "keep every
/// byte we persist inside this folder". Someone running the app off a USB
/// stick expects it to leave no trace on the host machine, so the settings
/// file, the model cache and the WebView2 profile all move here.
///
/// A marker file rather than an exe name or a CLI flag, because the portable
/// zip ships with it already in place -- users just extract and double-click.
/// Delete the marker and the same binary behaves like a normal install.
fn portable_data_dir() -> Option<PathBuf> {
    let dir = exe_dir();
    if dir.join("portable.txt").is_file() {
        Some(dir.join("data"))
    } else {
        None
    }
}

fn backend_command() -> Command {
    let mut cmd = if cfg!(debug_assertions) {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let py = format!("{manifest}/../backend/.venv/Scripts/python.exe");
        let script = format!("{manifest}/../backend/server_main.py");
        let mut c = Command::new(py);
        c.arg(script);
        c
    } else {
        Command::new(exe_dir().join("dpcleaner-server.exe"))
    };
    // The child inherits our environment, and both of these disarm the
    // backend's auth guard or pin its port. A stray value in the user's
    // environment must not be able to open up a packaged build.
    cmd.env_remove("DPC_DEV").env_remove("DPC_PORT");
    // Settings, model cache and embedding cache follow this; unset means the
    // backend falls back to the user's home directory, as an install should.
    match portable_data_dir() {
        Some(dir) => {
            let _ = std::fs::create_dir_all(&dir);
            cmd.env("DPC_DATA_DIR", dir);
        }
        None => {
            cmd.env_remove("DPC_DATA_DIR");
        }
    }
    cmd
}

/// Start the backend and block (in the caller's thread) until it prints its
/// handshake line, then keep draining its stdout so the pipe never blocks it.
/// stderr is drained into `log_path` (and echoed to our own stderr) so failures
/// are diagnosable even though the app runs without a console.
fn spawn_backend(log_path: PathBuf) -> Result<(Child, BackendInfo), String> {
    if let Some(dir) = log_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut log_file = File::create(&log_path).ok();
    let log_hint = format!("see {}", log_path.display());

    let mut cmd = backend_command();
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("could not start the engine: {e}");
            eprintln!("dpcleaner: {msg}");
            if let Some(f) = log_file.as_mut() {
                let _ = writeln!(f, "{msg}");
            }
            return Err(msg);
        }
    };

    // Adopt before any fallible step below, so no early return can leave a
    // process we no longer have a handle for.
    #[cfg(windows)]
    job::adopt(&child);

    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("engine stdout unavailable".into());
    };
    let stderr = child.stderr.take();
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
                    // Port 0 is not an endpoint: http://127.0.0.1:0 fails
                    // instantly and the webview caches the "successful" info,
                    // poisoning Retry permanently. Treat it as no handshake.
                    if port != 0 {
                        let _ = tx.send(BackendInfo { port, token });
                        sent = true;
                    }
                }
            }
            // keep looping to drain remaining stdout
        }
    });

    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                eprintln!("[dpcleaner backend] {line}");
                if let Some(f) = log_file.as_mut() {
                    let _ = writeln!(f, "{line}");
                    let _ = f.flush();
                }
            }
        });
    }

    // Generous: first run imports torch and may download the model.
    match rx.recv_timeout(HANDSHAKE_TIMEOUT) {
        Ok(info) => Ok((child, info)),
        // stdout hit EOF: the backend died during startup. Fail now rather
        // than making the splash wait out the full timeout for news we have.
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let _ = child.kill();
            Err(format!("the engine stopped while starting up ({log_hint})"))
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            let _ = child.kill();
            Err(format!(
                "the engine did not report ready within {}s ({log_hint})",
                HANDSHAKE_TIMEOUT.as_secs()
            ))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // A `webview2/` folder next to the exe is a bundled fixed-version WebView2
    // runtime, so the portable build works on machines that have none
    // installed. wry passes a null browserExecutableFolder, which makes the
    // loader fall back to this variable. Must be set before the webview starts.
    let fixed_runtime = exe_dir().join("webview2");
    if fixed_runtime.is_dir() {
        std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", &fixed_runtime);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![backend_info, backend_error])
        .setup(|app| {
            let portable_data = portable_data_dir();

            // The window is built here rather than declared in tauri.conf.json
            // because only this path can set an absolute WebView2 data
            // directory -- the config form is resolved relative to
            // %LOCALAPPDATA% and rejects absolute paths outright. Left alone,
            // Tauri forces it to %LOCALAPPDATA%\<identifier>, which is exactly
            // the trace a portable build must not leave.
            let mut win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("dpcleaner — 相似插畫清理")
                .inner_size(1180.0, 820.0)
                .min_inner_size(720.0, 560.0);
            if let Some(data) = &portable_data {
                win = win.data_directory(data.join("webview"));
            }
            win.build()?;

            // Log next to the app's own data, not the exe: an MSI install puts
            // the exe under Program Files, where File::create fails and every
            // diagnostic was silently dropped.
            let log_path = match &portable_data {
                Some(data) => data.join("dpcleaner-backend.log"),
                None => app
                    .path()
                    .app_log_dir()
                    .unwrap_or_else(|_| exe_dir())
                    .join("dpcleaner-backend.log"),
            };
            // Start the engine off the UI thread so the window paints immediately;
            // the frontend shows a "starting engine" splash while it polls.
            let handle = app.handle().clone();
            thread::spawn(move || {
                let state = handle.state::<AppState>();
                match spawn_backend(log_path) {
                    Ok((child, info)) => {
                        *state.backend.lock().unwrap() = Some(info);
                        *state.child.lock().unwrap() = Some(child);
                    }
                    Err(e) => {
                        eprintln!("dpcleaner: {e}");
                        *state.error.lock().unwrap() = Some(e);
                    }
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
