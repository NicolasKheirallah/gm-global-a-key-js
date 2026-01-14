use libloading::{Library, Symbol};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use thiserror::Error;

// J2534 Constants
pub const PASSTHRU_ERR_SUCCESS: i32 = 0;
pub const CAN: u32 = 0x00000006;
pub const CAN_29BIT_ID: u32 = 0x00000100;
pub const ISO15765: u32 = 0x00000007;

// Filter Types
pub const PASS_FILTER: u32 = 0x00000001;
pub const BLOCK_FILTER: u32 = 0x00000002;
pub const FLOW_CONTROL_FILTER: u32 = 0x00000003;

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
        // Construct standard CAN frame (4 byte ID, 1-12 byte data depending on protocol)
        let mut msg_data = Vec::with_capacity(data.len() + 4);
        msg_data.extend_from_slice(&id.to_be_bytes()); // ID at start
        msg_data.extend_from_slice(data);

        PassThruMsg {
            protocol_id: CAN,
            rx_status: 0,
            tx_flags: 0,
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
        let size = c_msg.data_size as usize;
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
            data_size: msg.data_size,
            extra_data_index: msg.extra_data_index,
            data,
        }
    }
}

pub struct J2534Driver {
    lib: Arc<Library>,
    device_id: u32,
    channel_id: u32,
}

// Helper to make moving Library easier if needed, though Arc is better
unsafe impl Send for J2534Driver {}
unsafe impl Sync for J2534Driver {}

impl J2534Driver {
    pub unsafe fn new(dll_path: &str) -> Result<Self, J2534Error> {
        let lib = Library::new(dll_path).map_err(|e| J2534Error::LoadError(e.to_string()))?;
        Ok(J2534Driver {
            lib: Arc::new(lib),
            device_id: 0,
            channel_id: 0,
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
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(device_id: u32, protocol_id: u32, flags: u32, baud: u32, channel_id: *mut u32) -> i32> = 
                self.lib.get(b"PassThruConnect").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut channel_id = 0;
            // Use CAN (0x06) or ISO15765 (0x07) depending on need, usually CAN for raw frame access
            let res = func(self.device_id, CAN, flags, baud, &mut channel_id);
             if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            self.channel_id = channel_id;
            Ok(())
        }
    }

    pub fn start_msg_filter(&self, mask: &PassThruMsg, pattern: &PassThruMsg) -> Result<u32, J2534Error> {
        unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, filter_type: u32, mask: *const CPassThruMsg, pattern: *const CPassThruMsg, flow_control: *const CPassThruMsg, filter_id: *mut u32) -> i32> =
                self.lib.get(b"PassThruStartMsgFilter").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let c_mask = CPassThruMsg::from(mask);
            let c_pattern = CPassThruMsg::from(pattern);
            // Flow control not used for PASS_FILTER
            let c_flow = std::ptr::null(); 

            let mut filter_id = 0;
            let res = func(self.channel_id, PASS_FILTER, &c_mask, &c_pattern, c_flow as *const CPassThruMsg, &mut filter_id);

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }
            Ok(filter_id)
        }
    }

    pub fn read_msgs(&self) -> Result<Vec<PassThruMsg>, J2534Error> {
         unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, msgs: *mut CPassThruMsg, num_msgs: *mut u32, timeout: u32) -> i32> = 
                self.lib.get(b"PassThruReadMsgs").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut num_msgs = 10; // Read up to 10
            let mut msgs: Vec<CPassThruMsg> = vec![
                CPassThruMsg {
                    protocol_id: 0, rx_status: 0, tx_flags: 0, timestamp: 0, data_size: 0, extra_data_index: 0, data: [0; 4128]
                };
                10
            ];

            let res = func(self.channel_id, msgs.as_mut_ptr(), &mut num_msgs, 100); // 100ms timeout
            if res != PASSTHRU_ERR_SUCCESS && res != 0x42 {
                // 0x42 is ERR_BUFFER_EMPTY, which is fine
                 if res == 0x42 { // ERR_BUFFER_EMPTY
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

     pub fn write_msgs(&self, msgs: Vec<PassThruMsg>) -> Result<(), J2534Error> {
         unsafe {
            let func: Symbol<unsafe extern "stdcall" fn(channel_id: u32, msgs: *mut CPassThruMsg, num_msgs: *mut u32, timeout: u32) -> i32> = 
                self.lib.get(b"PassThruWriteMsgs").map_err(|e| J2534Error::SymbolError(e.to_string()))?;

            let mut num_msgs = msgs.len() as u32;
            let mut c_msgs: Vec<CPassThruMsg> = msgs.iter().map(CPassThruMsg::from).collect();

            let res = func(self.channel_id, c_msgs.as_mut_ptr(), &mut num_msgs, 1000); // 1000ms timeout for write

            if res != PASSTHRU_ERR_SUCCESS {
                return Err(J2534Error::PassThruError(res));
            }

            Ok(())
         }
     }
     
     pub fn close(&mut self) -> Result<(), J2534Error> {
          unsafe {
            if let Ok(func) = self.lib.get::<unsafe extern "stdcall" fn(device_id: u32) -> i32>(b"PassThruClose") {
                 func(self.device_id);
            }
            Ok(())
        }
     }
}
