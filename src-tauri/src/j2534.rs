use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use std::os::raw::c_void;
use std::sync::Arc;
use thiserror::Error;

// J2534 Constants
pub const PASSTHRU_ERR_SUCCESS: i32 = 0;
pub const ERR_TIMEOUT: i32 = 0x00000009;
pub const ERR_BUFFER_EMPTY: i32 = 0x00000042;
pub const CAN: u32 = 0x00000006;
pub const CAN_29BIT_ID: u32 = 0x00000100;
pub const ISO15765: u32 = 0x00000007;

// Filter Types
pub const PASS_FILTER: u32 = 0x00000001;
pub const BLOCK_FILTER: u32 = 0x00000002;
pub const FLOW_CONTROL_FILTER: u32 = 0x00000003;

// IOCTL
pub const IOCTL_GET_CONFIG: u32 = 0x00000002;
pub const IOCTL_SET_CONFIG: u32 = 0x00000003;
pub const IOCTL_CLEAR_TX_BUFFER: u32 = 0x00000007;
pub const IOCTL_CLEAR_RX_BUFFER: u32 = 0x00000008;

// ISO15765 Config Params
pub const ISO15765_BS: u32 = 0x0000001E;
pub const ISO15765_STMIN: u32 = 0x0000001F;
pub const ISO15765_WFTMAX: u32 = 0x00000020;
pub const ISO15765_PAD_VALUE: u32 = 0x00000021;

#[derive(Debug, Clone, Copy)]
pub enum ProtocolKind {
    Can,
    Iso15765,
}

impl ProtocolKind {
    pub fn protocol_id(self) -> u32 {
        match self {
            ProtocolKind::Can => CAN,
            ProtocolKind::Iso15765 => ISO15765,
        }
    }
}

#[derive(Error, Debug, Serialize)]
pub enum J2534Error {
    #[error("DLL load failed: {0}")]
    LoadError(String),
    #[error("Function lookup failed: {0}")]
    SymbolError(String),
    #[error("J2534 Error Code: {0}")]
    PassThruError(i32),
    #[error("Device not open")]
    NotConnected,
    #[error("Channel not open: {0}")]
    ChannelNotOpen(String),
    #[error("Invalid config: {0}")]
    InvalidConfig(String),
    #[error("Version read failed: {0}")]
    VersionError(String),
}

#[derive(Debug, Serialize)]
pub struct J2534VersionInfo {
    pub api_version: String,
    pub dll_version: String,
    pub fw_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassThruMsg {
    pub protocol_id: u32,
    pub rx_status: u32,
    pub tx_flags: u32,
    pub timestamp: u32,
    pub data_size: u32,
    pub extra_data_index: u32,
    pub data: Vec<u8>,
}

impl PassThruMsg {
    pub fn new_can(id: u32, data: &[u8]) -> Self {
        Self::new(CAN, id, data, 0)
    }

    pub fn new_iso15765(id: u32, data: &[u8], tx_flags: u32) -> Self {
        Self::new(ISO15765, id, data, tx_flags)
    }

    pub fn new(protocol_id: u32, id: u32, data: &[u8], tx_flags: u32) -> Self {
        // Construct frame (4 byte ID + payload)
        let mut msg_data = Vec::with_capacity(data.len() + 4);
        msg_data.extend_from_slice(&id.to_be_bytes());
        msg_data.extend_from_slice(data);

        let mut flags = tx_flags;
        if id > 0x7FF {
            flags |= CAN_29BIT_ID;
        }

        PassThruMsg {
            protocol_id,
            rx_status: 0,
            tx_flags: flags,
            timestamp: 0,
            data_size: msg_data.len() as u32,
            extra_data_index: 0,
            data: msg_data,
        }
    }
}

// Raw C-compatible struct for FFI
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct CPassThruMsg {
    pub protocol_id: u32,
    pub rx_status: u32,
    pub tx_flags: u32,
    pub timestamp: u32,
    pub data_size: u32,
    pub extra_data_index: u32,
    pub data: [u8; 4128],
}

impl From<&CPassThruMsg> for PassThruMsg {
    fn from(c_msg: &CPassThruMsg) -> Self {
        let size = (c_msg.data_size as usize).min(4128);
        PassThruMsg {
            protocol_id: c_msg.protocol_id,
            rx_status: c_msg.rx_status,
            tx_flags: c_msg.tx_flags,
            timestamp: c_msg.timestamp,
            data_size: c_msg.data_size,
            extra_data_index: c_msg.extra_data_index,
            data: c_msg.data[0..size].to_vec(),
        }
    }
}

impl From<&PassThruMsg> for CPassThruMsg {
    fn from(msg: &PassThruMsg) -> Self {
        let mut data = [0u8; 4128];
        let size = msg.data.len().min(4128);
        data[0..size].copy_from_slice(&msg.data[0..size]);

        CPassThruMsg {
            protocol_id: msg.protocol_id,
            rx_status: msg.rx_status,
            tx_flags: msg.tx_flags,
            timestamp: msg.timestamp,
            data_size: size as u32,
            extra_data_index: msg.extra_data_index,
            data,
        }
    }
}

pub struct J2534Driver {
    lib: Arc<Library>,
    device_id: u32,
    can_channel_id: Option<u32>,
    iso_channel_id: Option<u32>,
    can_filter_ids: Vec<u32>,
    iso_filter_ids: Vec<u32>,
    iso_fc_filter_id: Option<u32>,
}

// Note: J2534Driver is wrapped in Arc<Mutex<>> in AppState for proper thread safety

impl J2534Driver {
    pub unsafe fn new(dll_path: &str) -> Result<Self, J2534Error> {
        let lib = Library::new(dll_path).map_err(|e| J2534Error::LoadError(e.to_string()))?;
        Ok(J2534Driver {
            lib: Arc::new(lib),
            device_id: 0,
            can_channel_id: None,
            iso_channel_id: None,
            can_filter_ids: Vec::new(),
            iso_filter_ids: Vec::new(),
            iso_fc_filter_id: None,
        })
    }

    pub fn open(&mut self) -> Result<(), J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(name: *const i8, device_id: *mut u32) -> i32> = 
                self.lib.get(b"PassThruOpen").map_err(|e| J2534Error::SymbolError(e.to_string()))?;
            
            let mut device_id = 0;
            // Pass null for name to open any connected device (or default)
            let res = func(std::ptr::null(), &mut device_id);

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            self.device_id = device_id;
            Ok(())
        }
    }

    pub fn connect_can(&mut self, baud: u32, flags: u32) -> Result<(), J2534Error> {
        let channel_id = self.connect_protocol(CAN, baud, flags)?;
        self.can_channel_id = Some(channel_id);
        Ok(())
    }

    pub fn connect_iso15765(&mut self, baud: u32, flags: u32) -> Result<(), J2534Error> {
        let channel_id = self.connect_protocol(ISO15765, baud, flags)?;
        self.iso_channel_id = Some(channel_id);
        Ok(())
    }

    fn connect_protocol(&self, protocol_id: u32, baud: u32, flags: u32) -> Result<u32, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(device_id: u32, protocol_id: u32, flags: u32, baud: u32, channel_id: *mut u32) -> i32> = 
                self.lib.get(b"PassThruConnect").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut channel_id = 0;
            let res = func(self.device_id, protocol_id, flags, baud, &mut channel_id);
             if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(channel_id)
        }
    }

    pub fn start_msg_filter(&self, channel_id: u32, mask: &PassThruMsg, pattern: &PassThruMsg) -> Result<u32, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, filter_type: u32, mask: *const CPassThruMsg, pattern: *const CPassThruMsg, flow_control: *const CPassThruMsg, filter_id: *mut u32) -> i32> =
                self.lib.get(b"PassThruStartMsgFilter").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let c_mask = CPassThruMsg::from(mask);
            let c_pattern = CPassThruMsg::from(pattern);
            // Flow control not used for PASS_FILTER
            let c_flow = std::ptr::null(); 

            let mut filter_id = 0;
            let res = func(channel_id, PASS_FILTER, &c_mask, &c_pattern, c_flow as *const CPassThruMsg, &mut filter_id);

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(filter_id)
        }
    }

    /// Start a flow control filter for ISO-TP (ISO 15765) multi-frame messaging.
    /// This is REQUIRED for proper multi-frame UDS communication.
    /// - tx_id: The ID used by the tester to send requests (e.g., 0x7E0)
    /// - rx_id: The ID used by the ECU to send responses (e.g., 0x7E8)
    /// - block_size/st_min: ISO-TP flow control parameters
    pub fn start_flow_control_filter(
        &self,
        channel_id: u32,
        tx_id: u32,
        rx_id: u32,
        block_size: u8,
        st_min: u8,
        pad_value: Option<u8>,
    ) -> Result<u32, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, filter_type: u32, mask: *const CPassThruMsg, pattern: *const CPassThruMsg, flow_control: *const CPassThruMsg, filter_id: *mut u32) -> i32> =
                self.lib.get(b"PassThruStartMsgFilter").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            // For flow control filter, mask and pattern match the ECU response ID
            // Flow control message uses the tester TX ID
            let is_extended = rx_id > 0x7FF;
            let mask_id = if is_extended { 0x1FFFFFFF } else { 0x7FF };
            
            let mask = PassThruMsg::new(ISO15765, mask_id, &[], 0);
            let pattern = PassThruMsg::new(ISO15765, rx_id, &[], 0);
            let mut fc_data = vec![0x30u8, block_size, st_min];
            if let Some(pad) = pad_value {
                while fc_data.len() < 8 {
                    fc_data.push(pad);
                }
            }
            let flow_control = PassThruMsg::new(ISO15765, tx_id, &fc_data, 0);

            let c_mask = CPassThruMsg::from(&mask);
            let c_pattern = CPassThruMsg::from(&pattern);
            let c_flow = CPassThruMsg::from(&flow_control);

            let mut filter_id = 0;
            let res = func(channel_id, FLOW_CONTROL_FILTER, &c_mask, &c_pattern, &c_flow, &mut filter_id);

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(filter_id)
        }
    }

    pub fn stop_msg_filter(&self, channel_id: u32, filter_id: u32) -> Result<(), J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, filter_id: u32) -> i32> =
                self.lib.get(b"PassThruStopMsgFilter").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let res = func(channel_id, filter_id);
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(())
        }
    }

    pub fn read_msgs(&self, channel_id: u32, max_msgs: u32, timeout_ms: u32) -> Result<Vec<PassThruMsg>, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, msgs: *mut CPassThruMsg, num_msgs: *mut u32, timeout: u32) -> i32> = 
                self.lib.get(b"PassThruReadMsgs").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut num_msgs = max_msgs.max(1);
            let mut msgs: Vec<CPassThruMsg> = vec![
                CPassThruMsg {
                    protocol_id: 0, rx_status: 0, tx_flags: 0, timestamp: 0, data_size: 0, extra_data_index: 0, data: [0; 4128]
                };
                num_msgs as usize
            ];

            let res = func(channel_id, msgs.as_mut_ptr(), &mut num_msgs, timeout_ms);
            if res != PASSTHRU_ERR_SUCCESS {
                if res == ERR_BUFFER_EMPTY || res == ERR_TIMEOUT {
                    return Ok(vec![]);
                }
                return Err(J2534Error::PassThruError(res));
            }

            let mut result = Vec::new();
            for i in 0..num_msgs as usize {
                result.push(PassThruMsg::from(&msgs[i]));
            }
            Ok(result)
        }
    }

    pub fn write_msgs(&self, channel_id: u32, msgs: Vec<PassThruMsg>, timeout_ms: u32) -> Result<(), J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, msgs: *mut CPassThruMsg, num_msgs: *mut u32, timeout: u32) -> i32> = 
                self.lib.get(b"PassThruWriteMsgs").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut num_msgs = msgs.len() as u32;
            let mut c_msgs: Vec<CPassThruMsg> = msgs.iter().map(CPassThruMsg::from).collect();

            let res = func(channel_id, c_msgs.as_mut_ptr(), &mut num_msgs, timeout_ms);

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            Ok(())
        }
    }
     
    pub fn close(&mut self) -> Result<(), J2534Error> {
        unsafe {
            if let Some(channel_id) = self.can_channel_id.take() {
                let _ = self.disconnect_channel(channel_id);
            }
            if let Some(channel_id) = self.iso_channel_id.take() {
                let _ = self.disconnect_channel(channel_id);
            }
            if let Ok(func) = self.lib.get::<unsafe extern "stdcall" fn(device_id: u32) -> i32>(b"PassThruClose") {
                let res = func(self.device_id);
                if res != PASSTHRU_ERR_SUCCESS {
                    return Err(J2534Error::PassThruError(res));
                }
            }
            Ok(())
        }
    }

    pub fn disconnect_channel(&self, channel_id: u32) -> Result<(), J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32) -> i32> =
                self.lib.get(b"PassThruDisconnect").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let res = func(channel_id);
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(())
        }
    }

    pub fn channel_id(&self, protocol: ProtocolKind) -> Result<u32, J2534Error> {
        match protocol {
            ProtocolKind::Can => self.can_channel_id.ok_or_else(|| J2534Error::ChannelNotOpen("CAN".to_string())),
            ProtocolKind::Iso15765 => self.iso_channel_id.ok_or_else(|| J2534Error::ChannelNotOpen("ISO15765".to_string())),
        }
    }

    pub fn set_pass_filter(&mut self, protocol: ProtocolKind, mask_id: u32, pattern_id: u32) -> Result<(), J2534Error> {
        self.set_pass_filters(protocol, &[(mask_id, pattern_id)])
    }

    pub fn set_pass_filters(&mut self, protocol: ProtocolKind, filters: &[(u32, u32)]) -> Result<(), J2534Error> {
        let channel_id = self.channel_id(protocol)?;
        self.clear_filters(protocol)?;

        let mut ids = Vec::new();
        for (mask_id, pattern_id) in filters {
            let mask = PassThruMsg::new(protocol.protocol_id(), *mask_id, &[], 0);
            let pattern = PassThruMsg::new(protocol.protocol_id(), *pattern_id, &[], 0);
            let filter_id = self.start_msg_filter(channel_id, &mask, &pattern)?;
            ids.push(filter_id);
        }

        match protocol {
            ProtocolKind::Can => self.can_filter_ids = ids,
            ProtocolKind::Iso15765 => self.iso_filter_ids = ids,
        }
        Ok(())
    }

    pub fn set_flow_control_filter(
        &mut self,
        tx_id: u32,
        rx_id: u32,
        block_size: u8,
        st_min: u8,
        pad_value: Option<u8>,
    ) -> Result<(), J2534Error> {
        let channel_id = self.channel_id(ProtocolKind::Iso15765)?;
        self.clear_flow_control_filter()?;

        let filter_id = self.start_flow_control_filter(
            channel_id,
            tx_id,
            rx_id,
            block_size,
            st_min,
            pad_value,
        )?;
        self.iso_fc_filter_id = Some(filter_id);
        Ok(())
    }

    pub fn clear_flow_control_filter(&mut self) -> Result<(), J2534Error> {
        let channel_id = self.channel_id(ProtocolKind::Iso15765)?;
        if let Some(filter_id) = self.iso_fc_filter_id.take() {
            let _ = self.stop_msg_filter(channel_id, filter_id);
        }
        Ok(())
    }

    pub fn clear_filters(&mut self, protocol: ProtocolKind) -> Result<(), J2534Error> {
        let channel_id = self.channel_id(protocol)?;
        let ids = match protocol {
            ProtocolKind::Can => std::mem::take(&mut self.can_filter_ids),
            ProtocolKind::Iso15765 => std::mem::take(&mut self.iso_filter_ids),
        };

        for filter_id in ids {
            let _ = self.stop_msg_filter(channel_id, filter_id);
        }
        Ok(())
    }

    pub fn clear_buffers(&self, channel_id: u32) -> Result<(), J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, ioctl_id: u32, input: *mut c_void, output: *mut c_void) -> i32> =
                self.lib.get(b"PassThruIoctl").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let res = func(channel_id, IOCTL_CLEAR_RX_BUFFER, std::ptr::null_mut(), std::ptr::null_mut());
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            let res = func(channel_id, IOCTL_CLEAR_TX_BUFFER, std::ptr::null_mut(), std::ptr::null_mut());
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            Ok(())
        }
    }

    pub fn set_config(&self, channel_id: u32, params: &mut [SConfig]) -> Result<(), J2534Error> {
        if params.is_empty() {
            return Err(J2534Error::InvalidConfig("No params provided".to_string()));
        }

        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, ioctl_id: u32, input: *mut c_void, output: *mut c_void) -> i32> =
                self.lib.get(b"PassThruIoctl").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut list = SConfigList {
                num_of_params: params.len() as u32,
                params: params.as_mut_ptr(),
            };

            let res = func(
                channel_id,
                IOCTL_SET_CONFIG,
                (&mut list as *mut SConfigList) as *mut c_void,
                std::ptr::null_mut(),
            );
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(())
        }
    }

    pub fn get_config(&self, channel_id: u32, params: &mut [SConfig]) -> Result<Vec<SConfig>, J2534Error> {
        if params.is_empty() {
            return Err(J2534Error::InvalidConfig("No params provided".to_string()));
        }

        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, ioctl_id: u32, input: *mut c_void, output: *mut c_void) -> i32> =
                self.lib.get(b"PassThruIoctl").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut list = SConfigList {
                num_of_params: params.len() as u32,
                params: params.as_mut_ptr(),
            };

            let res = func(
                channel_id,
                IOCTL_GET_CONFIG,
                (&mut list as *mut SConfigList) as *mut c_void,
                std::ptr::null_mut(),
            );
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(params.to_vec())
        }
    }

    pub fn configure_iso15765(&self, channel_id: u32, config: IsoTpConfig) -> Result<(), J2534Error> {
        let mut params = Vec::new();

        if let Some(block_size) = config.block_size {
            params.push(SConfig { parameter: ISO15765_BS, value: block_size });
        }
        if let Some(st_min) = config.st_min {
            params.push(SConfig { parameter: ISO15765_STMIN, value: st_min });
        }
        if let Some(wft_max) = config.wft_max {
            params.push(SConfig { parameter: ISO15765_WFTMAX, value: wft_max });
        }
        if let Some(pad_value) = config.pad_value {
            params.push(SConfig { parameter: ISO15765_PAD_VALUE, value: pad_value });
        }

        self.set_config(channel_id, &mut params)
    }

    pub fn read_version(&self) -> Result<J2534VersionInfo, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(device_id: u32, api: *mut i8, dll: *mut i8, fw: *mut i8) -> i32> =
                self.lib.get(b"PassThruReadVersion").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut api_buf = vec![0i8; 80];
            let mut dll_buf = vec![0i8; 80];
            let mut fw_buf = vec![0i8; 80];

            let res = func(
                self.device_id,
                api_buf.as_mut_ptr(),
                dll_buf.as_mut_ptr(),
                fw_buf.as_mut_ptr(),
            );

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            Ok(J2534VersionInfo {
                api_version: cstr_to_string(&api_buf),
                dll_version: cstr_to_string(&dll_buf),
                fw_version: cstr_to_string(&fw_buf),
            })
        }
    }

    pub fn get_last_error(&self) -> Result<String, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(error_text: *mut i8) -> i32> =
                self.lib.get(b"PassThruGetLastError").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut buf = vec![0i8; 256];
            let res = func(buf.as_mut_ptr());
            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            Ok(cstr_to_string(&buf))
        }
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SConfig {
    pub parameter: u32,
    pub value: u32,
}

#[repr(C)]
#[derive(Debug)]
pub struct SConfigList {
    pub num_of_params: u32,
    pub params: *mut SConfig,
}

#[derive(Debug, Clone, Copy)]
pub struct IsoTpConfig {
    pub block_size: Option<u32>,
    pub st_min: Option<u32>,
    pub wft_max: Option<u32>,
    pub pad_value: Option<u32>,
}

fn cstr_to_string(buf: &[i8]) -> String {
    let bytes: Vec<u8> = buf
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).to_string()
}
