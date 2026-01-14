// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod j2534;
mod gmlan; // Phase 4 addition

use j2534::{IsoTpConfig, J2534Driver, J2534VersionInfo, PassThruMsg, ProtocolKind, SConfig};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::State;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct J2534Device {
    name: String,
    vendor: String,
    dll_path: String,
}

struct AppState {
    driver: Arc<Mutex<Option<J2534Driver>>>,
    heartbeat: Mutex<Option<HeartbeatHandle>>,
}

struct HeartbeatHandle {
    stop: Arc<AtomicBool>,
    join: Option<thread::JoinHandle<()>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RxMessage {
    id: u32,
    data: Vec<u8>,
    timestamp: u32,
    rx_status: u32,
    protocol_id: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct ScanResult {
    id: u32,
    response: Vec<u8>,
    protocol: String,
}

#[derive(Debug, Deserialize)]
struct ConnectParams {
    #[serde(alias = "dllPath", alias = "dll_path")]
    dll_path: String,
    baud: u32,
    flags: u32,
}

#[derive(Debug, Deserialize)]
struct ReadParams {
    protocol: String,
    max_msgs: Option<u32>,
    timeout_ms: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct FilterParams {
    protocol: String,
    mask_id: u32,
    pattern_id: u32,
}

#[derive(Debug, Deserialize)]
struct FilterDef {
    mask_id: u32,
    pattern_id: u32,
}

#[derive(Debug, Deserialize)]
struct FilterListParams {
    protocol: String,
    filters: Vec<FilterDef>,
}

#[derive(Debug, Deserialize)]
struct ScanParams {
    module_ids: Vec<u32>,
    request: Vec<u8>,
    timeout_ms: Option<u32>,
    response_offset: Option<u32>,
    protocol: Option<String>,
    protocols: Option<Vec<String>>,
    retries: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ConfigParam {
    parameter: u32,
    value: u32,
}

#[derive(Debug, Deserialize)]
struct IsoTpConfigParams {
    block_size: Option<u32>,
    st_min: Option<u32>,
    wft_max: Option<u32>,
    pad_value: Option<u32>,
    params: Option<Vec<ConfigParam>>,
}

#[derive(Debug, Serialize)]
struct IsoTpConfigRead {
    block_size: u32,
    st_min: u32,
    wft_max: u32,
    pad_value: u32,
}

#[derive(Debug, Deserialize)]
struct HeartbeatParams {
    protocol: String,
    id: u32,
    data: Vec<u8>,
    interval_ms: Option<u64>,
}

fn parse_protocol(protocol: &str) -> Result<ProtocolKind, String> {
    match protocol.to_lowercase().as_str() {
        "can" => Ok(ProtocolKind::Can),
        "iso15765" | "isotp" | "iso-tp" => Ok(ProtocolKind::Iso15765),
        _ => Err(format!("Unsupported protocol: {protocol}")),
    }
}

fn to_rx_message(msg: PassThruMsg) -> Option<RxMessage> {
    if msg.data.len() < 4 {
        return None;
    }
    let id = u32::from_be_bytes([msg.data[0], msg.data[1], msg.data[2], msg.data[3]]);
    let data = msg.data[4..].to_vec();
    Some(RxMessage {
        id,
        data,
        timestamp: msg.timestamp,
        rx_status: msg.rx_status,
        protocol_id: msg.protocol_id,
    })
}

fn stop_heartbeat_inner(state: &AppState) {
    if let Some(mut hb) = state.heartbeat.lock().unwrap().take() {
        hb.stop.store(true, Ordering::SeqCst);
        if let Some(join) = hb.join.take() {
            let _ = join.join();
        }
    }
}

#[tauri::command]
fn list_j2534_devices() -> Result<Vec<J2534Device>, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let mut devices = Vec::new();

        let paths = [
            "SOFTWARE\\PassThruSupport.04.04",
            "SOFTWARE\\WOW6432Node\\PassThruSupport.04.04",
        ];

        for path in paths {
            if let Ok(passthru) = hklm.open_subkey(path) {
                for name in passthru.enum_keys() {
                    let name = match name {
                        Ok(n) => n,
                        Err(_) => continue,
                    };
                    if let Ok(device_key) = passthru.open_subkey(&name) {
                        let vendor: String = device_key.get_value("Vendor").unwrap_or_default();
                        let name_str: String = device_key.get_value("Name").unwrap_or(name.clone());
                        let dll_path: String = device_key.get_value("FunctionLibrary").unwrap_or_default();

                        if !dll_path.is_empty() {
                            devices.push(J2534Device {
                                name: name_str,
                                vendor,
                                dll_path,
                            });
                        }
                    }
                }
            }
        }

        Ok(devices)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("J2534 is only supported on Windows".to_string())
    }
}

#[tauri::command]
async fn connect_j2534(
    state: State<'_, AppState>,
    params: ConnectParams
) -> Result<String, String> {
    let mut driver = state.driver.lock().unwrap();

    if driver.is_some() {
        return Err("Already connected".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("J2534 is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut new_driver = unsafe {
            J2534Driver::new(&params.dll_path).map_err(|e| e.to_string())?
        };

        new_driver.open().map_err(|e| e.to_string())?;
        if let Err(err) = new_driver.connect_can(params.baud, params.flags) {
            let _ = new_driver.close();
            return Err(err.to_string());
        }
        if let Err(err) = new_driver.connect_iso15765(params.baud, params.flags) {
            let _ = new_driver.close();
            return Err(err.to_string());
        }

        *driver = Some(new_driver);
        Ok("Connected successfully (CAN + ISO15765)".to_string())
    }
}

#[tauri::command]
async fn disconnect_j2534(state: State<'_, AppState>) -> Result<String, String> {
    stop_heartbeat_inner(state.inner());
    let mut driver = state.driver.lock().unwrap();
    if let Some(mut d) = driver.take() {
        let _ = d.close();
    }
    Ok("Disconnected".to_string())
}

#[tauri::command]
async fn read_j2534_version(state: State<'_, AppState>) -> Result<J2534VersionInfo, String> {
    let driver_guard = state.driver.lock().unwrap();
    if let Some(driver) = driver_guard.as_ref() {
        driver.read_version().map_err(|e| e.to_string())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn get_j2534_last_error(state: State<'_, AppState>) -> Result<String, String> {
    let driver_guard = state.driver.lock().unwrap();
    if let Some(driver) = driver_guard.as_ref() {
        driver.get_last_error().map_err(|e| e.to_string())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn read_messages(
    state: State<'_, AppState>,
    params: ReadParams
) -> Result<Vec<RxMessage>, String> {
    let driver_guard = state.driver.lock().unwrap();

    #[cfg(not(target_os = "windows"))]
    {
        return Err("J2534 is only supported on Windows".to_string());
    }

    let protocol = parse_protocol(&params.protocol)?;
    let max_msgs = params.max_msgs.unwrap_or(10);
    let timeout_ms = params.timeout_ms.unwrap_or(100);

    if let Some(driver) = driver_guard.as_ref() {
        let channel_id = driver.channel_id(protocol).map_err(|e| e.to_string())?;
        let msgs = driver
            .read_msgs(channel_id, max_msgs, timeout_ms)
            .map_err(|e| e.to_string())?;
        Ok(msgs.into_iter().filter_map(to_rx_message).collect())
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
        return Err("J2534 is only supported on Windows".to_string());
    }

    let driver_guard = state.driver.lock().unwrap();
    if let Some(driver) = driver_guard.as_ref() {
        let channel_id = driver.channel_id(ProtocolKind::Can).map_err(|e| e.to_string())?;
        let msg = PassThruMsg::new_can(id, &data);
        driver
            .write_msgs(channel_id, vec![msg], 1000)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn send_isotp(
    state: State<'_, AppState>,
    id: u32,
    data: Vec<u8>
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("J2534 is only supported on Windows".to_string());
    }

    let driver_guard = state.driver.lock().unwrap();
    if let Some(driver) = driver_guard.as_ref() {
        let channel_id = driver
            .channel_id(ProtocolKind::Iso15765)
            .map_err(|e| e.to_string())?;
        let msg = PassThruMsg::new_iso15765(id, &data, 0);
        driver
            .write_msgs(channel_id, vec![msg], 1000)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn set_rx_filter(
    state: State<'_, AppState>,
    params: FilterParams
) -> Result<(), String> {
    let mut driver_guard = state.driver.lock().unwrap();
    let protocol = parse_protocol(&params.protocol)?;

    if let Some(driver) = driver_guard.as_mut() {
        driver
            .set_pass_filter(protocol, params.mask_id, params.pattern_id)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn clear_rx_filter(
    state: State<'_, AppState>,
    protocol: String
) -> Result<(), String> {
    let mut driver_guard = state.driver.lock().unwrap();
    let protocol = parse_protocol(&protocol)?;

    if let Some(driver) = driver_guard.as_mut() {
        driver.clear_filters(protocol).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn set_rx_filters(
    state: State<'_, AppState>,
    params: FilterListParams
) -> Result<(), String> {
    let mut driver_guard = state.driver.lock().unwrap();
    let protocol = parse_protocol(&params.protocol)?;

    let mut filters = Vec::new();
    for f in params.filters {
        filters.push((f.mask_id, f.pattern_id));
    }

    if let Some(driver) = driver_guard.as_mut() {
        driver
            .set_pass_filters(protocol, &filters)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn set_isotp_config(
    state: State<'_, AppState>,
    params: IsoTpConfigParams
) -> Result<(), String> {
    let driver_guard = state.driver.lock().unwrap();

    if let Some(driver) = driver_guard.as_ref() {
        let channel_id = driver
            .channel_id(ProtocolKind::Iso15765)
            .map_err(|e| e.to_string())?;

        if let Some(raw_params) = params.params {
            let mut configs: Vec<SConfig> = raw_params
                .into_iter()
                .map(|p| SConfig { parameter: p.parameter, value: p.value })
                .collect();
            driver
                .set_config(channel_id, &mut configs)
                .map_err(|e| e.to_string())?;
            return Ok(());
        }

        let config = IsoTpConfig {
            block_size: params.block_size,
            st_min: params.st_min,
            wft_max: params.wft_max,
            pad_value: params.pad_value,
        };
        if config.block_size.is_none()
            && config.st_min.is_none()
            && config.wft_max.is_none()
            && config.pad_value.is_none()
        {
            return Err("No ISO-TP config values provided".to_string());
        }
        driver
            .configure_iso15765(channel_id, config)
            .map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn get_isotp_config(state: State<'_, AppState>) -> Result<IsoTpConfigRead, String> {
    let driver_guard = state.driver.lock().unwrap();

    if let Some(driver) = driver_guard.as_ref() {
        let channel_id = driver
            .channel_id(ProtocolKind::Iso15765)
            .map_err(|e| e.to_string())?;

        let mut params = vec![
            SConfig { parameter: j2534::ISO15765_BS, value: 0 },
            SConfig { parameter: j2534::ISO15765_STMIN, value: 0 },
            SConfig { parameter: j2534::ISO15765_WFTMAX, value: 0 },
            SConfig { parameter: j2534::ISO15765_PAD_VALUE, value: 0 },
        ];

        let values = driver.get_config(channel_id, &mut params).map_err(|e| e.to_string())?;
        let mut read = IsoTpConfigRead {
            block_size: 0,
            st_min: 0,
            wft_max: 0,
            pad_value: 0,
        };

        for cfg in values {
            match cfg.parameter {
                j2534::ISO15765_BS => read.block_size = cfg.value,
                j2534::ISO15765_STMIN => read.st_min = cfg.value,
                j2534::ISO15765_WFTMAX => read.wft_max = cfg.value,
                j2534::ISO15765_PAD_VALUE => read.pad_value = cfg.value,
                _ => {}
            }
        }

        Ok(read)
    } else {
        Err("Device not connected".to_string())
    }
}

#[tauri::command]
async fn start_heartbeat(
    state: State<'_, AppState>,
    params: HeartbeatParams
) -> Result<(), String> {
    stop_heartbeat_inner(state.inner());

    let protocol = parse_protocol(&params.protocol)?;
    let interval_ms = params.interval_ms.unwrap_or(2000);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let driver = state.driver.clone();
    let data = params.data.clone();
    let id = params.id;

    let join = thread::spawn(move || {
        while !stop_thread.load(Ordering::SeqCst) {
            {
                let guard = driver.lock().unwrap();
                let driver = match guard.as_ref() {
                    Some(d) => d,
                    None => break,
                };
                let channel_id = match driver.channel_id(protocol) {
                    Ok(id) => id,
                    Err(_) => break,
                };
                let msg = match protocol {
                    ProtocolKind::Can => PassThruMsg::new_can(id, &data),
                    ProtocolKind::Iso15765 => PassThruMsg::new_iso15765(id, &data, 0),
                };
                let _ = driver.write_msgs(channel_id, vec![msg], 500);
            }
            thread::sleep(Duration::from_millis(interval_ms));
        }
    });

    let mut hb_guard = state.heartbeat.lock().unwrap();
    *hb_guard = Some(HeartbeatHandle {
        stop,
        join: Some(join),
    });

    Ok(())
}

#[tauri::command]
async fn stop_heartbeat(state: State<'_, AppState>) -> Result<(), String> {
    stop_heartbeat_inner(state.inner());
    Ok(())
}

#[tauri::command]
async fn scan_modules(
    state: State<'_, AppState>,
    params: ScanParams
) -> Result<Vec<ScanResult>, String> {
    let mut driver_guard = state.driver.lock().unwrap();

    #[cfg(not(target_os = "windows"))]
    {
        return Err("J2534 is only supported on Windows".to_string());
    }

    let timeout_ms = params.timeout_ms.unwrap_or(200);
    let response_offset = params.response_offset.unwrap_or(8);
    let retries = params.retries.unwrap_or(1);
    let mut protocols: Vec<ProtocolKind> = Vec::new();
    if let Some(list) = params.protocols {
        for p in list {
            protocols.push(parse_protocol(&p)?);
        }
    } else if let Some(p) = params.protocol {
        protocols.push(parse_protocol(&p)?);
    } else {
        protocols.push(ProtocolKind::Can);
    }

    if let Some(driver) = driver_guard.as_mut() {
        let mut results = Vec::new();
        for protocol in protocols {
            let channel_id = driver
                .channel_id(protocol)
                .map_err(|e| e.to_string())?;
            let protocol_str = match protocol {
                ProtocolKind::Can => "can",
                ProtocolKind::Iso15765 => "iso15765",
            }
            .to_string();

            for id in &params.module_ids {
                let id = *id;
                let mask = if id > 0x7FF { 0x1FFFFFFF } else { 0x7FF };
                let response_id = id.wrapping_add(response_offset);
                driver
                    .set_pass_filter(protocol, mask, response_id)
                    .map_err(|e| e.to_string())?;

                let mut found = None;
                for _ in 0..=retries {
                    let msg = match protocol {
                        ProtocolKind::Can => PassThruMsg::new_can(id, &params.request),
                        ProtocolKind::Iso15765 => PassThruMsg::new_iso15765(id, &params.request, 0),
                    };
                    let _ = driver.write_msgs(channel_id, vec![msg], 500);

                    let msgs = driver
                        .read_msgs(channel_id, 1, timeout_ms)
                        .map_err(|e| e.to_string())?;
                    if let Some(resp) = msgs.into_iter().filter_map(to_rx_message).next() {
                        found = Some(resp);
                        break;
                    }
                }

                if let Some(resp) = found {
                    results.push(ScanResult {
                        id,
                        response: resp.data,
                        protocol: protocol_str.clone(),
                    });
                }
            }
        }
        Ok(results)
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
    const TABLE: &[u8] = include_bytes!("../resources/gmlan.bin");
    let algos = gmlan::brute_force(seed, known_key, TABLE);
    Ok(algos.iter().map(|a| format!("{a:02X}")).collect())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            driver: Arc::new(Mutex::new(None)),
            heartbeat: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            list_j2534_devices,
            connect_j2534,
            disconnect_j2534,
            read_j2534_version,
            get_j2534_last_error,
            read_messages,
            send_can,
            send_isotp,
            set_rx_filter,
            clear_rx_filter,
            set_rx_filters,
            set_isotp_config,
            get_isotp_config,
            start_heartbeat,
            stop_heartbeat,
            scan_modules,
            brute_force_gmlan_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
