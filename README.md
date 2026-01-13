# GM Key Tools (Node.js & Web)

A unified, high-performance toolkit for **GM Seed/Key calculation**, supporting both legacy **16-bit GMLAN** and modern **5-byte SA015** algorithms. This project re-implements original Python/C reverse engineering logic into a modern **TypeScript Monorepo**, offering both a robust Node.js CLI and an offline-capable Web Application.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![React](https://img.shields.io/badge/React-18-blue)
![Vite](https://img.shields.io/badge/Vite-6.0-purple)
![Node.js](https://img.shields.io/badge/Node.js-v22-green)

## 🌟 Key Features

- **Universal Core**: A shared, side-effect-free library (`@gm-key/core`) powering both Web and CLI.
- **Hardware Integration**: Direct vehicle communication via **Web Serial API** (chrome/edge) for Seed reading and Ecu Unlocking.
- **High Performance**:
  - **Web Workers**: Offloads heavy O(n) brute-force reverse engineering tasks to background threads.
  - **Optimized VM**: The GMLAN engine acts as a virtual machine executing opcode triples from compressed lookup tables.
- **Developer Centric**: Built with **strictly typed TypeScript**, **Vite**, and **npm workspaces**.

---

## Technical Architecture

The project follows a strict Monorepo structure to ensure code sharing and separation of concerns.

### 1. **@gm-key/core** (`packages/core`)

The brain of the operation. Contains 0 dependencies on DOM or Node.js specific APIs (uses a custom `crypto-shim` for cross-platform compatibility).

- **GMLANEngine**: Implements a 16-bit virtual machine that interprets bytecode tables (Byte Swap, Rotate, Add, XOR) identical to the original ECU firmware logic.
- **SA015Engine**: Implements the proprietary `AES-128` + `SHA-256` pipeline. It manages the "Password Blob" lookup map and performs the iterative hashing and encryption steps required to derive the 5-byte key.
- **LogParser**: Regex-based state machine for parsing raw serial logs (J2534/ELM327) to extract `27 01` (Seed Request) and `67 01` (Seed Response) pairs.

### 2. **@gm-key/cli** (`packages/cli`)

A Node.js implementation focusing on automation and piping.

- Uses `commander` for argument parsing and `inquirer` for interactive wizards.
- tailored for scripting and batch processing of logs.

### 3. **@gm-key/web** (`packages/web`)

A React 18 + Vite application.

- **State Management**: React Hooks for managing serial connection state and calculation history.
- **Workers**: Uses Comlink or native Worker API to run the `GMLANEngine.bruteForceAll` method without freezing the main UI thread.
- **Theme**: Custom CSS variables implementation of a "Scandinavian Minimalist" dark/light mode.

---

## Getting Started

### Prerequisites

- **Node.js**: v22+ (Required for latest crypto stack)
- **npm**: v10+

### Installation

```bash
git clone https://github.com/your-repo/gm-key-js.git
cd gm-key-js
npm install
# Builds all workspaces (Core, CLI, Web)
npm run build
```

---

## Command Line Interface (CLI)

The CLI is designed for power users and automation.

### Quick Start (Interactive)

Run without arguments to start the wizard:

```bash
npx tsx packages/cli/src/index.ts
```

### Commands

**1. Parse Log Files**
Extract seeds and keys from a saved J2534 or Serial log file.

```bash
npx tsx packages/cli/src/index.ts parse-log ./session.log --json
```

**2. GMLAN (Legacy 16-bit)**
Calculate a single key.

```bash
# Usage: gmlan -s <seed> -a <algo_id> [-t <table>]
npx tsx packages/cli/src/index.ts gmlan -s D435 -a 0x89 --table gmlan
```

- `--table`: Choose between `gmlan` (Standard), `class2` (Older), or `others` (Misc).

**3. SA015 (Modern 5-byte)**
Derive a global-A style key.

```bash
# Usage: sa015 -s <seed> -a <algo_id>
npx tsx packages/cli/src/index.ts sa015 -s 8CE7D1FD06 -a 0x87
```

**4. Reverse Engineer (Find Algo)**
Recover the Algorithm ID used by an ECU if you have a known Seed/Key pair.

```bash
npx tsx packages/cli/src/index.ts find-algo -s D435 -k 3257
```

---

## Web Application Features

The Web App (`packages/web`) offers a complete GUI for vehicle interaction.

### Hardware Tab (Web Serial)

Directly interact with ECUs using an **ELM327** (USB) or **STN1110** device.

1.  **Connect**: Select the COM port in the browser popup.
2.  **Select Module**: Choose target (ECM/TCM `7E0`, BCM `241`, etc.) to set the correct CAN headers.
3.  **Read Seed**: Sends `ATZ` -> `ATCH` -> `10 03` -> `27 01` to request a seed.
4.  **Unlock**: After calculation, click **Unlock** to send `27 02 <KEY>` back to the ECU to grant security access.

### Logs Tab

Paste raw logs from **Tech2Win** or **GDS2**. The parser will:

- Highlight valid Seed/Key exchanges.
- Extract the Seed and automatically fill the Calculator tab.

### Calculator Tabs

- **Legacy GMLAN**: Supports single calculation and "Brute Force" (trying all 255 algos against a seed).
- **SA015**: Standard 5-byte calculator.

---

## Development

### Running Tests

Unit tests use `vitest` and cover the Core logic heavily to ensure mathematical correctness.

```bash
npm run test --workspaces
```

### Linting

```bash
npm run lint --workspaces
```

### Production Build

```bash
npm run build
# Artifacts are generated in:
# packages/web/dist
# packages/core/dist
# packages/cli/dist
```

---

## ⚠️ Disclaimer

**Educational Use Only.**
This software is provided for research, interoperability, and educational purposes. The authors assume no liability for misuse, property damage, or legal consequences resulting from the use of this tool. Always ensure you have authorization before interacting with vehicle control modules.

Special thanks to @Chriva for the reverse engineering
