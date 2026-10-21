use crate::AppState;
use keytap_core::{backup::import_backup as do_import_backup, qr::{decode_otpauth_from_png, OtpAuthAccount}, vault::VaultAccount};
use std::path::PathBuf;
use tauri::State;

#[tauri::command] pub fn get_vault_status(state: State<'_, AppState>) -> String {
    match state.vault.lock().unwrap().as_ref() { Some(v) => format!("{:?}", v.status()), None => "no-vault".into() }
}
#[tauri::command] pub fn create_vault(state: State<'_, AppState>, path: String, passphrase: String) -> Result<(), String> {
    let v = Vault::create_new(&PathBuf::from(&path), passphrase.as_bytes()).map_err(|e| e.to_string())?;
    *state.vault.lock().unwrap() = Some(v); Ok(())
}
#[tauri::command] pub fn unlock_vault(state: State<'_, AppState>, path: String, passphrase: String) -> Result<(), String> {
    let v = Vault::open(&PathBuf::from(&path), passphrase.as_bytes()).map_err(|e| e.to_string())?;
    *state.vault.lock().unwrap() = Some(v); Ok(())
}
#[tauri::command] pub fn lock_vault(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(v) = state.vault.lock().unwrap().as_ref() { v.lock(); } Ok(())
}
#[tauri::command] pub fn list_accounts(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let v = state.vault.lock().unwrap().as_ref().ok_or("not open")?;
    Ok(v.list_accounts().into_iter().map(|a| serde_json::to_value(a).unwrap()).collect())
}
#[tauri::command] pub fn add_account(state: State<'_, AppState>, account: VaultAccount) -> Result<(), String> {
    state.vault.lock().unwrap().as_ref().ok_or("not open")?.add_account(account).map_err(|e| e.to_string())
}
#[tauri::command] pub fn delete_account(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.vault.lock().unwrap().as_ref().ok_or("not open")?.delete_account(&id).map_err(|e| e.to_string())
}
#[tauri::command] pub fn export_backup(_state: State<'_, AppState>, _pass: String) -> Result<Vec<u8>, String> {
    Err("Phase 4 follow-up".into())
}
#[tauri::command] pub fn import_backup(_state: State<'_, AppState>, bytes: Vec<u8>, pass: String) -> Result<Vec<VaultAccount>, String> {
    do_import_backup(&bytes, pass.as_bytes()).map_err(|e| e.to_string())
}
#[tauri::command] pub fn scan_qr(png: Vec<u8>) -> Result<OtpAuthAccount, String> {
    decode_otpauth_from_png(&png).map_err(|e| e.to_string())
}

use keytap_core::Vault as _Vault;
