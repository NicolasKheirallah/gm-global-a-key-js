# GM Key Tools

A high-performance web toolkit for **GM Seed/Key calculation**, supporting both legacy **16-bit GMLAN** and modern **5-byte SA015** algorithms.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![React](https://img.shields.io/badge/React-18-blue)
![Vite](https://img.shields.io/badge/Vite-6.0-purple)

## 🌟 Features

- **Dual Algorithm Support**: Both GMLAN (16-bit) and SA015 (5-byte) key calculation
- **Hardware Integration**: Direct ECU communication via **Web Serial API** (Chrome/Edge)
- **Log Parsing**: Extract seeds from J2534, ELM327, Tech2Win, and GDS2 logs
- **High Performance**: Web Workers for brute-force operations without UI freeze
- **Dark/Light Mode**: Clean, modern interface

---

## Getting Started

### Prerequisites

- **Node.js**: v22+
- **npm**: v10+

### Installation

```bash
git clone https://github.com/NicolasKheirallah/gm-global-a-key-js.git
cd gm-global-a-key-js
npm install
npm run dev
```

### Production Build

```bash
npm run build
# Output in dist/
```

---

## Web Application

### Calculator Tabs

- **Legacy GMLAN**: 16-bit seed/key calculation with brute-force option
- **SA015**: Modern 5-byte algorithm with progress tracking

### Logs Tab

Paste raw logs from Tech2Win or GDS2. The parser will:

- Detect log format (J2534, ELM327, Tech2Win, GDS2)
- Extract seed/key pairs
- Identify ECU modules by CAN ID

### Hardware Tab (Web Serial)

Direct ECU interaction using ELM327/STN1110 devices:

1. **Connect**: Select COM port
2. **Select Module**: ECM (7E0), TCM (7E1), BCM (241), etc.
3. **Read Seed**: Sends `27 01` to request seed
4. **Unlock**: Send calculated key with `27 02`

---

## Project Structure

```
src/
├── core/           # Algorithm library
│   ├── gmlan.ts    # GMLAN 16-bit engine
│   ├── sa015.ts    # SA015 5-byte engine
│   ├── uds.ts      # ISO 14229 UDS protocol
│   └── ...
├── components/     # React components
├── hooks/          # React hooks
├── services/       # Serial communication
└── App.tsx
```

---

## Development

### Run Tests

```bash
npm run test
```

### Lint

```bash
npm run lint
```

---

## ⚠️ Disclaimer

**Educational Use Only.**

This software is provided for research, interoperability, and educational purposes. The authors assume no liability for misuse, property damage, or legal consequences. Always ensure you have authorization before interacting with vehicle control modules.

---

Special thanks to @Chriva for the reverse engineering
