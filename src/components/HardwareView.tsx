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

  const handleConnect = async () => {
    try {
      if (isJ2534 && selectedDevice && serialService.setDllPath) {
        serialService.setDllPath(selectedDevice);
      }
      await serialService.connect();
      appendLog("Connected to device successfully.");
    } catch (e) {
      appendLog(
        `Connection failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleDisconnect = async () => {
    await serialService.disconnect();
    appendLog("Disconnected.");
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

    for (const mod of GM_MODULES) {
      try {
        await serialService.send(`ATSH ${mod.id}`, 200);
        const resp = await serialService.send("3E 00", 300);
        if (resp && (resp.includes("7E") || resp.includes("7F"))) {
          appendLog(`[FOUND] ${mod.name} (${mod.id}) - ${resp}`);
          found++;
        }
      } catch (e) {
        // Ignore timeouts
      }
    }

    appendLog(`Scan Complete. Found ${found} modules.`);
    setIsScanning(false);
    await serialService.send(`ATSH ${ecuHeader}`);
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
                placeholder="Key (e.g. A1B2)"
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
