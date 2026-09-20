mod platform;

use platform::InstallFlavor;
use tauri::Manager;

/// What the app knows about where it is running. The frontend shows some of it
/// on the about screen; the updater decides what it may do with the rest.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSummary {
    os: String,
    arch: String,
    app_version: String,
    install_flavor: InstallFlavor,
    supports_in_app_update: bool,
}

#[tauri::command]
fn platform_summary(app: tauri::AppHandle) -> PlatformSummary {
    let flavor = InstallFlavor::current();
    PlatformSummary {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_version: app.package_info().version.to_string(),
        install_flavor: flavor,
        supports_in_app_update: flavor.supports_in_app_update(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("the main window is declared in tauri.conf.json");
            platform::window::apply_backdrop(&window);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![platform_summary])
        .run(tauri::generate_context!())
        .expect("error while running ytbm");
}
