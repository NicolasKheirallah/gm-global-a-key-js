// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod j2534;
mod gmlan; // Phase 4 addition

use j2534::{J2534Driver, J2534Error, PassThruMsg};
use std::sync::{Arc, Mutex};
use tauri::State;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct J2534Device {
    name: String,
    vendor: String,
    dll_path: String,
}

struct AppState {
    driver: Mutex<Option<J2534Driver>>,
}

#[tauri::command]
fn list_j2534_devices() -> Result<Vec<J2534Device>, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        // Try to open PassThruSupport.04.04
        let passthru_res = hklm.open_subkey("SOFTWARE\\PassThruSupport.04.04");
        
        if let Ok(passthru) = passthru_res {
             let mut devices = Vec::new();
             for name in passthru.enum_keys().map(|x| x.unwrap()) {
                if let Ok(device_key) = passthru.open_subkey(&name) {
                    let vendor: String = device_key.get_value("Vendor").unwrap_or_default();
                    let name_str: String = device_key.get_value("Name").unwrap_or(name.clone());
                    let dll_path: String = device_key.get_value("FunctionLibrary").unwrap_or_default();

                    if !dll_path.is_empty() {
                        devices.push(J2534Device {
                            name: name_str,
                            vendor,
                            dll_path
                        });
                    }
                }
            }
            return Ok(devices);
        }
        
        // If not found or empty
        Ok(Vec::new())
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![
            J2534Device {
                name: "Tactrix OpenPort 2.0 (Mock)".to_string(),
                vendor: "Tactrix Inc.".to_string(),
                dll_path: "/mock/libop20pt32.dylib".to_string(),
            },
        ])
    }
}

#[tauri::command]
async fn connect_j2534(
    state: State<'_, AppState>,
    dll_path: String,
    baud: u32,
    flags: u32
) -> Result<String, String> {
    let mut driver = state.driver.lock().unwrap();

    if driver.is_some() {
        return Err("Already connected".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        println!("Mock Connected to {} at {} bps", dll_path, baud);
        return Ok("Connected (Mock)".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut new_driver = unsafe {
            J2534Driver::new(&dll_path).map_err(|e| e.to_string())?
        };

        new_driver.open().map_err(|e| e.to_string())?;
        new_driver.connect_can(baud, flags).map_err(|e| e.to_string())?;

        *driver = Some(new_driver);
        Ok("Connected successfully".to_string())
    }
}

#[tauri::command]
async fn disconnect_j2534(state: State<'_, AppState>) -> Result<String, String> {
    let mut driver = state.driver.lock().unwrap();
    if let Some(mut d) = driver.take() {
        let _ = d.close(); 
    }
    Ok("Disconnected".to_string())
}

#[tauri::command]
async fn read_messages(state: State<'_, AppState>) -> Result<Vec<PassThruMsg>, String> {
    let driver_guard = state.driver.lock().unwrap();

    #[cfg(not(target_os = "windows"))]
    {
        return Ok(Vec::new());
    }
    
    if let Some(driver) = driver_guard.as_ref() {
        driver.read_msgs().map_err(|e| e.to_string())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn send_can(
    state: State<'_, AppState>,
    id: u32,
    data: Vec<u8>
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        println!("Mock TX: ID={:X} Data={:?}", id, data);
        return Ok(());
    }

    let driver_guard = state.driver.lock().unwrap();
    if let Some(driver) = driver_guard.as_ref() {
         let msg = PassThruMsg::new_can(id, &data);
         driver.write_msgs(vec![msg]).map_err(|e| e.to_string())?;
         Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

// Phase 4: GMLAN Brute Force
#[tauri::command]
async fn brute_force_gmlan_key(
    seed: u16,
    known_key: u16 // Optional target if reverse engineering, but for now lets just expose standard calc
) -> Result<Vec<String>, String> {
    // This is a placeholder. 
    // Real implementation will call gmlan::brute_force
    // For now we just return a stub to ensure things compile while we write gmlan.rs
    Ok(vec!["Algo not implemented yet".to_string()])
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            driver: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_j2534_devices,
            connect_j2534,
            disconnect_j2534,
            read_messages,
            send_can,
            brute_force_gmlan_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
