// Keytap desktop app — Tauri v2 scaffold. Phase 4 follow-up implements the GUI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use keytap_core::Vault;
mod commands;
mod logging;

fn main() {
    logging::init();
    tracing::info!("keytap desktop app starting");
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_vault_status, commands::create_vault, commands::unlock_vault,
            commands::lock_vault, commands::list_accounts, commands::add_account,
            commands::delete_account, commands::export_backup, commands::import_backup, commands::scan_qr,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(Default)]
pub struct AppState { pub vault: std::sync::Mutex<Option<Vault>> }
