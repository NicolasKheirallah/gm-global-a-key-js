import { useState, useCallback, useEffect } from "react";
import { Plug, Lock, Loader2, XCircle, Zap, Search } from "lucide-react";
import styles from "./View.module.css";
import { type ConnectionState } from "../services/SerialService";
import type { HardwareService } from "../services/HardwareService";
import { GM_MODULES } from "../data/modules";

interface HardwareViewProps {
  onSeedFound: (seed: string) => void;
  serialService: HardwareService;
}

const formatHex = (val: string, maxBytes: number): string => {
  const clean = val.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return clean.slice(0, maxBytes * 2);
};

export function HardwareView({
  onSeedFound,
  serialService,
}: HardwareViewProps) {
  const [logs, setLogs] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    serialService.state
  );
  const [ecuHeader, setEcuHeader] = useState("7E0");
  const [keyToUnlock, setKeyToUnlock] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [j2534Devices, setJ2534Devices] = useState<
    Array<{ name: string; dll_path: string }>
  >([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [transportMode, setTransportMode] = useState<"isotp" | "can">("isotp");
  const [addressingMode, setAddressingMode] = useState<
    "physical" | "functional"
  >("physical");
  const [scanMode, setScanMode] = useState<"auto" | "can" | "iso15765">("auto");
  const [isoTpConfig, setIsoTpConfig] = useState({
    blockSize: "0",
    stMin: "0",
    wftMax: "0",
    padValue: "",
  });
  const [responseFilterIds, setResponseFilterIds] = useState("");
  const [structuredCommand, setStructuredCommand] = useState("22 F1 90");
  const [structuredResult, setStructuredResult] = useState("");

  const isJ2534 = serialService && "listDevices" in serialService;

  useEffect(() => {
    if (isJ2534 && serialService.listDevices) {
      serialService.listDevices().then((devices) => {
        setJ2534Devices(devices);
        if (devices.length > 0) setSelectedDevice(devices[0].dll_path);
      });
    }
  }, [serialService, isJ2534]);

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => `${prev}[${timestamp}] ${message}\n`);
  }, []);

  useEffect(() => {
    serialService.setHandlers({
      onStateChange: (state) => {
        setConnectionState(state);
        appendLog(`Connection State: ${state}`);
      },
      onError: (error) => {
        appendLog(`ERROR: ${error.message}`);
      },
      onData: () => {},
    });
    setConnectionState(serialService.state);
  }, [serialService, appendLog]);

  useEffect(() => {
    if (!serialService.isConnected) return;

    const headerId = parseInt(ecuHeader, 16);
    if (Number.isNaN(headerId)) return;

    if (isJ2534 && "setHeader" in serialService) {
      (serialService as { setHeader?: (id: number) => Promise<void> })
        .setHeader?.(headerId)
        .catch((e) =>
          appendLog(
            `Header update failed: ${e instanceof Error ? e.message : String(e)}`
          )
        );
    } else {
      serialService.send(`ATSH ${ecuHeader}`).catch(() => {});
    }
  }, [ecuHeader, serialService, isJ2534, appendLog]);

  const handleConnect = async () => {
    try {
      if (isJ2534 && selectedDevice && serialService.setDllPath) {
        serialService.setDllPath(selectedDevice);
      }
      await serialService.connect();
      if (serialService.startHeartbeat) {
        await serialService.startHeartbeat(2000, true);
      }
      appendLog("Connected to device successfully.");
    } catch (e) {
      appendLog(
        `Connection failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleDisconnect = async () => {
    if (serialService.stopHeartbeat) {
      await serialService.stopHeartbeat();
    }
    await serialService.disconnect();
    appendLog("Disconnected.");
  };

  const handleReadDeviceInfo = async () => {
    if (!serialService.isConnected || !serialService.getDeviceInfo) return;
    try {
      const info = await serialService.getDeviceInfo();
      appendLog(
        `Device Info: API=${info.api_version} DLL=${info.dll_version} FW=${info.fw_version}`
      );
    } catch (e) {
      appendLog(
        `Device Info Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleReadLastError = async () => {
    if (!serialService.isConnected || !serialService.getLastError) return;
    try {
      const err = await serialService.getLastError();
      appendLog(`J2534 Last Error: ${err}`);
    } catch (e) {
      appendLog(
        `Last Error Read Failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleReadIsoTpConfig = async () => {
    if (!serialService.isConnected || !serialService.getIsoTpConfig) return;
    try {
      const config = await serialService.getIsoTpConfig();
      setIsoTpConfig({
        blockSize: String(config.block_size),
        stMin: String(config.st_min),
        wftMax: String(config.wft_max),
        padValue: config.pad_value ? config.pad_value.toString(16).toUpperCase() : "",
      });
      appendLog(
        `ISO-TP Config: BS=${config.block_size} STmin=${config.st_min} WFTmax=${config.wft_max} PAD=${config.pad_value}`
      );
    } catch (e) {
      appendLog(
        `ISO-TP Config Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleScan = async () => {
    if (!serialService.isConnected) {
      appendLog("Error: Not connected to hardware.");
      return;
    }

    setIsScanning(true);
    appendLog(`Sending Seed Request to ECU ${ecuHeader}...`);

    try {
      const result = await serialService.executeSeedRequest(ecuHeader);
      appendLog(result.log);

      const seedMatch = /67\s*0?1\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i.exec(
        result.seed
      );

      if (seedMatch) {
        const fullSeed = `${seedMatch[1]}${seedMatch[2]}`;
        appendLog(`SUCCESS: Found GMLAN Seed ${fullSeed}`);
        onSeedFound(fullSeed);
      } else {
        const seed5Match =
          /67\s*0?1\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i.exec(
            result.seed
          );

        if (seed5Match) {
          const fullSeed = `${seed5Match[1]}${seed5Match[2]}${seed5Match[3]}${seed5Match[4]}${seed5Match[5]}`;
          appendLog(`SUCCESS: Found Global A Seed ${fullSeed}`);
          onSeedFound(fullSeed);
        } else {
          appendLog("FAILED: No recognized seed in response.");
        }
      }
    } catch (e) {
      appendLog(
        `Error reading seed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleNetworkScan = async () => {
    if (!serialService.isConnected) return;

    setIsScanning(true);
    appendLog("Starting Network Scan (Ping all modules)...");
    let found = 0;

    if (serialService.scanNetwork) {
      const moduleIds = GM_MODULES.map((m) => parseInt(m.id, 16)).filter(
        (id) => !Number.isNaN(id)
      );
      try {
        const protocols =
          scanMode === "auto"
            ? (["can", "iso15765"] as Array<"can" | "iso15765">)
            : ([scanMode] as Array<"can" | "iso15765">);
        const retries = scanMode === "can" ? 1 : 2;
        const results = await serialService.scanNetwork(
          moduleIds,
          protocols,
          retries
        );
        for (const res of results) {
          const hexId = res.id.toString(16).toUpperCase().padStart(3, "0");
          const mod =
            GM_MODULES.find((m) => m.id.toUpperCase() === hexId) ?? null;
          appendLog(
            `[FOUND] ${mod ? mod.name : "Unknown"} (${hexId}) - ${res.response}`
          );
          found++;
        }
      } catch (e) {
        appendLog(
          `Scan failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    } else {
      for (const mod of GM_MODULES) {
        try {
          await serialService.send(`ATSH ${mod.id}`, 200);
          const resp = await serialService.send("3E 00", 300);
          if (resp && (resp.includes("7E") || resp.includes("7F"))) {
            appendLog(`[FOUND] ${mod.name} (${mod.id}) - ${resp}`);
            found++;
          }
        } catch {
          // Ignore timeouts
        }
      }
    }

    appendLog(`Scan Complete. Found ${found} modules.`);
    setIsScanning(false);
    await serialService.send(`ATSH ${ecuHeader}`);
  };

  const applyAdvancedSettings = async () => {
    if (!isJ2534) return;
    if (!serialService.isConnected) {
      appendLog("Error: Connect first to apply settings.");
      return;
    }

    try {
      if (transportMode === "can") {
        await serialService.send("ATTP CAN");
      } else {
        await serialService.send("ATTP ISO");
      }

      if (serialService.setAddressingMode) {
        await serialService.setAddressingMode(addressingMode);
      } else if (addressingMode === "functional") {
        await serialService.send("ATSH 7DF");
        if (serialService.setFunctionalResponseRange) {
          await serialService.setFunctionalResponseRange(0x7e8, 0x7f0);
        }
      } else {
        await serialService.send(`ATSH ${ecuHeader}`);
      }

      if (responseFilterIds.trim() && serialService.setResponseFilters) {
        const ids = responseFilterIds
          .split(",")
          .map((id) => parseInt(id.trim(), 16))
          .filter((id) => !Number.isNaN(id));
        const filters = ids.map((id) => ({
          mask: id > 0x7ff ? 0x1fffffff : 0x7ff,
          pattern: id,
        }));
        await serialService.setResponseFilters(filters, ids);
      }

      if (serialService.setIsoTpConfig) {
        const blockSize = Number(isoTpConfig.blockSize);
        const stMin = Number(isoTpConfig.stMin);
        const wftMax = Number(isoTpConfig.wftMax);
        if (Number.isNaN(blockSize) || Number.isNaN(stMin) || Number.isNaN(wftMax)) {
          throw new Error("ISO-TP parameters must be numeric");
        }

        const config = {
          block_size: blockSize,
          st_min: stMin,
          wft_max: wftMax,
          pad_value: isoTpConfig.padValue
            ? parseInt(isoTpConfig.padValue, 16)
            : undefined,
        };
        await serialService.setIsoTpConfig(config);
      }

      appendLog("Advanced settings applied.");
    } catch (e) {
      appendLog(
        `Failed to apply settings: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleStructuredSend = async () => {
    if (!serialService.isConnected) {
      appendLog("Error: Not connected to hardware.");
      return;
    }
    if (!structuredCommand.trim()) {
      appendLog("Error: Enter a command to send.");
      return;
    }

    try {
      if (serialService.sendAndCollectById) {
        const results = await serialService.sendAndCollectById(
          structuredCommand,
          2000
        );
        const lines = Object.values(results).map((entry) => {
          const idHex = entry.id.toString(16).toUpperCase();
          const payloads = entry.responses
            .map((resp, i) => `  [${entry.timestamps[i]}] ${resp}`)
            .join("\n");
          return `ID ${idHex}:\n${payloads}`;
        });
        setStructuredResult(lines.join("\n"));
      } else if (serialService.sendAndCollect) {
        const results = await serialService.sendAndCollect(
          structuredCommand,
          2000
        );
        setStructuredResult(results.join("\n"));
      } else {
        const result = await serialService.send(structuredCommand, 2000);
        setStructuredResult(result);
      }
    } catch (e) {
      setStructuredResult(
        `Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleUnlock = async () => {
    if (!serialService.isConnected) return;
    try {
      appendLog(`Sending Key ${keyToUnlock}...`);
      const result =
        keyToUnlock.length === 10
          ? await serialService.sendKey5Byte(keyToUnlock)
          : await serialService.sendKey(keyToUnlock);

      appendLog(result);
      if (result.includes("67 02") || result.includes("6702")) {
        appendLog("SUCCESS: ECU Unlocked!");
      } else {
        appendLog("FAILED: Unlock failed (NRC or Bad Key).");
      }
    } catch (e) {
      appendLog(`Error: ${e}`);
    }
  };

  const isConnected = connectionState === "connected";

  return (
    <div className={styles.view}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "1.5rem",
        }}
      >
        {/* Left Column: Connection */}
        <div className={styles.card}>
          <h3>
            <Plug size={18} /> Connection Settings
          </h3>

          <div className={styles.formGroup}>
            <label>Interface Type</label>
            <div
              style={{
                padding: "0.75rem",
                background: "rgba(0,0,0,0.2)",
                borderRadius: "6px",
                color: "var(--text-secondary)",
                fontSize: "0.9rem",
              }}
            >
              {isJ2534
                ? "J2534 PassThru (Native)"
                : "ELM327 / OBDLink (Serial)"}
            </div>
          </div>

          {isJ2534 && (
            <div className={styles.formGroup}>
              <label>Select Device</label>
              <select
                value={selectedDevice}
                onChange={(e) => setSelectedDevice(e.target.value)}
                disabled={isConnected}
              >
                {j2534Devices.length === 0 && (
                  <option>No J2534 Devices Found</option>
                )}
                {j2534Devices.map((d) => (
                  <option key={d.dll_path} value={d.dll_path}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!isConnected ? (
            <button
              className={styles.button}
              onClick={handleConnect}
              disabled={connectionState === "connecting"}
            >
              {connectionState === "connecting" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plug size={18} />
              )}
              {isJ2534 ? "Open Device" : "Connect Serial"}
            </button>
          ) : (
            <button
              className={`${styles.button} ${styles.danger}`}
              onClick={handleDisconnect}
            >
              <XCircle size={18} /> Disconnect
            </button>
          )}

          <div style={{ marginTop: "1.5rem" }}>
            <button
              className={styles.button}
              onClick={handleNetworkScan}
              disabled={!isConnected || isScanning}
            >
              {isScanning ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search size={18} />
              )}
              Scan Network (Identify Modules)
            </button>
          </div>

          {isJ2534 && (
            <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
              <button
                className={styles.button}
                onClick={handleReadDeviceInfo}
                disabled={!isConnected}
              >
                Read Device Info
              </button>
              <button
                className={styles.button}
                onClick={handleReadLastError}
                disabled={!isConnected}
              >
                Read Last Error
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Actions */}
        <div className={styles.card}>
          <h3>
            <Zap size={18} /> Diagnostic Actions
          </h3>

          <div className={styles.formGroup}>
            <label>Target Module (Header)</label>
            <select
              value={ecuHeader}
              onChange={(e) => setEcuHeader(e.target.value)}
            >
              {GM_MODULES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} - {m.name}
                </option>
              ))}
            </select>
          </div>

          <button
            className={styles.button}
            onClick={handleScan}
            disabled={!isConnected || isScanning}
          >
            {isScanning ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Lock size={18} />
            )}
            Read Seed (27 01)
          </button>

          <div
            style={{
              margin: "1.5rem 0",
              height: "1px",
              background: "var(--border-glass)",
            }}
          />

          <div className={styles.formGroup}>
            <label>Key Input</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={keyToUnlock}
                onChange={(e) => setKeyToUnlock(formatHex(e.target.value, 5))}
                placeholder="Key (e.g. AFAB)"
              />
              <button
                className={styles.button}
                style={{ width: "auto" }}
                onClick={handleUnlock}
                disabled={!isConnected}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>

        {/* Advanced J2534 Settings */}
        <div className={styles.card}>
          <h3>
            <Zap size={18} /> Advanced (J2534)
          </h3>

          <div className={styles.formGroup}>
            <label>Transport Mode</label>
            <select
              value={transportMode}
              onChange={(e) =>
                setTransportMode(e.target.value as "isotp" | "can")
              }
              disabled={!isJ2534 || !isConnected}
            >
              <option value="isotp">ISO-TP (Multi-frame)</option>
              <option value="can">CAN (Single-frame)</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Addressing Mode</label>
            <select
              value={addressingMode}
              onChange={(e) =>
                setAddressingMode(e.target.value as "physical" | "functional")
              }
              disabled={!isJ2534 || !isConnected}
            >
              <option value="physical">Physical (7E0/7E8)</option>
              <option value="functional">Functional (7DF/7E8..7EF)</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Scan Mode</label>
            <select
              value={scanMode}
              onChange={(e) =>
                setScanMode(e.target.value as "auto" | "can" | "iso15765")
              }
              disabled={!isJ2534 || !isConnected}
            >
              <option value="auto">Auto (CAN + ISO-TP)</option>
              <option value="can">CAN Only</option>
              <option value="iso15765">ISO-TP Only</option>
            </select>
          </div>

          <div className={styles.formGroup}>
            <label>Response Filter IDs (hex, comma-separated)</label>
            <input
              value={responseFilterIds}
              onChange={(e) => setResponseFilterIds(e.target.value)}
              placeholder="e.g. 7E8,7E9"
              disabled={!isJ2534 || !isConnected}
            />
          </div>

          <div className={styles.formGroup}>
            <label>ISO-TP Block Size (BS)</label>
            <input
              value={isoTpConfig.blockSize}
              onChange={(e) =>
                setIsoTpConfig((prev) => ({
                  ...prev,
                  blockSize: e.target.value,
                }))
              }
              disabled={!isJ2534 || !isConnected}
            />
          </div>

          <div className={styles.formGroup}>
            <label>ISO-TP STmin</label>
            <input
              value={isoTpConfig.stMin}
              onChange={(e) =>
                setIsoTpConfig((prev) => ({
                  ...prev,
                  stMin: e.target.value,
                }))
              }
              disabled={!isJ2534 || !isConnected}
            />
          </div>

          <div className={styles.formGroup}>
            <label>ISO-TP WFTmax</label>
            <input
              value={isoTpConfig.wftMax}
              onChange={(e) =>
                setIsoTpConfig((prev) => ({
                  ...prev,
                  wftMax: e.target.value,
                }))
              }
              disabled={!isJ2534 || !isConnected}
            />
          </div>

          <div className={styles.formGroup}>
            <label>ISO-TP Pad Value (hex, optional)</label>
            <input
              value={isoTpConfig.padValue}
              onChange={(e) =>
                setIsoTpConfig((prev) => ({
                  ...prev,
                  padValue: formatHex(e.target.value, 1),
                }))
              }
              disabled={!isJ2534 || !isConnected}
            />
          </div>

          <button
            className={styles.button}
            onClick={handleReadIsoTpConfig}
            disabled={!isJ2534 || !isConnected}
          >
            Read ISO-TP Config
          </button>

          <button
            className={styles.button}
            onClick={applyAdvancedSettings}
            disabled={!isJ2534 || !isConnected}
          >
            Apply Advanced Settings
          </button>
        </div>

        {/* Structured Response Panel */}
        <div className={styles.card}>
          <h3>
            <Search size={18} /> Structured Response
          </h3>

          <div className={styles.formGroup}>
            <label>UDS Command</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                value={structuredCommand}
                onChange={(e) => setStructuredCommand(e.target.value)}
                placeholder="e.g. 22 F1 90"
              />
              <button
                className={styles.button}
                style={{ width: "auto" }}
                onClick={handleStructuredSend}
                disabled={!isConnected}
              >
                Send
              </button>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Responses by ID</label>
            <div
              className={styles.terminal}
              style={{ minHeight: "140px", maxHeight: "240px" }}
            >
              {structuredResult || "No structured responses yet."}
            </div>
          </div>
        </div>
      </div>

      <div className={styles.resultArea}>
        <label>Live Terminal</label>
        <div className={styles.terminal}>
          {logs || "System Ready. Waiting for device..."}
        </div>
      </div>
    </div>
  );
}
