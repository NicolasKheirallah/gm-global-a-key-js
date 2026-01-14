
// GMLAN 16-bit Seed/Key Algorithm
// High Performance Rust Implementation

use std::num::Wrapping;

// Opcode Constants
pub const OP_BYTE_SWAP: u8 = 0x05;
pub const OP_ADD_HL: u8 = 0x14;
pub const OP_COMPLEMENT: u8 = 0x2a;
pub const OP_AND_LH: u8 = 0x37;
pub const OP_ROL: u8 = 0x4c;
pub const OP_OR_HL: u8 = 0x52;
pub const OP_ROR: u8 = 0x6b;
pub const OP_ADD_LH: u8 = 0x75;
pub const OP_SWAP_ADD: u8 = 0x7e;
pub const OP_SUB_HL: u8 = 0x98;
pub const OP_SUB_LH: u8 = 0xf8;

// Helper: Truncate to 16-bit
fn w(val: u32) -> u16 {
    (val & 0xFFFF) as u16
}

fn op_05(val: u16) -> u16 {
    let v = val as u32;
    w((v << 8) | (v >> 8))
}

fn op_14(val: u16, hh: u8, ll: u8) -> u16 {
    let add_val = ((hh as u32) << 8) | (ll as u32);
    w(val as u32 + add_val)
}

fn op_2a(val: u16, hh: u8, ll: u8) -> u16 {
    let mut new_val = w(!(val as u32));
    if hh < ll {
        new_val = w(new_val as u32 + 1);
    }
    new_val
}

fn op_37(val: u16, hh: u8, ll: u8) -> u16 {
    let and_val = ((ll as u32) << 8) | (hh as u32);
    w(val as u32 & and_val)
}

fn op_4c(val: u16, hh: u8, _ll: u8) -> u16 {
    let shift = (hh & 0x0F) as u32;
    if shift == 0 {
        return val;
    }
    let v = val as u32;
    w((v << shift) | (v >> (16 - shift)))
}

fn op_52(val: u16, hh: u8, ll: u8) -> u16 {
    let or_val = ((ll as u32) << 8) | (hh as u32);
    w(val as u32 | or_val)
}

fn op_6b(val: u16, _hh: u8, ll: u8) -> u16 {
    let shift = (ll & 0x0F) as u32;
    if shift == 0 {
        return val;
    }
    let v = val as u32;
    w((v >> shift) | (v << (16 - shift)))
}

fn op_75(val: u16, hh: u8, ll: u8) -> u16 {
    let add_val = ((ll as u32) << 8) | (hh as u32);
    w(val as u32 + add_val)
}

fn op_7e(val: u16, hh: u8, ll: u8) -> u16 {
    if hh >= ll {
        op_14(op_05(val), hh, ll)
    } else {
        op_75(op_05(val), hh, ll)
    }
}

fn op_98(val: u16, hh: u8, ll: u8) -> u16 {
    let sub_val = ((hh as u32) << 8) | (ll as u32);
    w((Wrapping(val as u32) - Wrapping(sub_val)).0)
}

fn op_f8(val: u16, hh: u8, ll: u8) -> u16 {
    let sub_val = ((ll as u32) << 8) | (hh as u32);
    w((Wrapping(val as u32) - Wrapping(sub_val)).0)
}

pub fn calculate_key(seed: u16, algo: u8, table: &[u8]) -> Result<u16, String> {
    if algo == 0 {
        return Ok(!seed);
    }
    
    // GMLAN tables can have two formats:
    // - Legacy 13-byte stride: 4 operations × 3 bytes + 1 byte (typically algo ID or padding)
    // - Extended 16-byte stride: 5 operations × 3 bytes + 1 byte
    // Detect format based on table size and known algorithm count
    
    // Heuristic: if table is divisible by 16 and large enough, use 16-byte stride
    let (stride, op_count) = if table.len() >= 4096 && table.len() % 16 == 0 {
        (16usize, 5usize)
    } else {
        (13usize, 4usize)
    };
    
    let idx = (algo as usize) * stride;
    if idx + (op_count * 3) > table.len() {
        return Err("Algorithm definition out of bounds".to_string());
    }
    
    let mut seed_word = seed;
    let mut cursor = idx;
    
    for _ in 0..op_count {
        let opcode = table[cursor];
        let hh = table[cursor + 1];
        let ll = table[cursor + 2];
        
        // Stop early if opcode is 0x00 (NOP/end marker)
        if opcode == 0x00 {
            break;
        }
        
        match opcode {
            OP_BYTE_SWAP => seed_word = op_05(seed_word),
            OP_ADD_HL => seed_word = op_14(seed_word, hh, ll),
            OP_COMPLEMENT => seed_word = op_2a(seed_word, hh, ll),
            OP_AND_LH => seed_word = op_37(seed_word, hh, ll),
            OP_ROL => seed_word = op_4c(seed_word, hh, ll),
            OP_OR_HL => seed_word = op_52(seed_word, hh, ll),
            OP_ROR => seed_word = op_6b(seed_word, hh, ll),
            OP_ADD_LH => seed_word = op_75(seed_word, hh, ll),
            OP_SWAP_ADD => seed_word = op_7e(seed_word, hh, ll),
            OP_SUB_HL => seed_word = op_98(seed_word, hh, ll),
            OP_SUB_LH => seed_word = op_f8(seed_word, hh, ll),
            _ => {
                // Unknown opcode: treat as NOP for parity with gmseedcalc
            }
        }
        
        cursor += 3;
    }
    
    Ok(seed_word)
}

// Brute Force: Try all 256 algorithms
// Needs the table data passed in or embedded.
// In production, we should load `gmlan.bin`.
pub fn brute_force(seed: u16, known_key: u16, table: &[u8]) -> Vec<u8> {
    let mut found_algos = Vec::new();
    
    // Use same stride detection as calculate_key
    let stride = if table.len() >= 4096 && table.len() % 16 == 0 { 16 } else { 13 };
    let max_algo = (table.len() / stride) as u8;
    
    for algo in 0..max_algo {
        if let Ok(calc) = calculate_key(seed, algo, table) {
            if calc == known_key {
                found_algos.push(algo);
            }
        }
    }
    found_algos
}
