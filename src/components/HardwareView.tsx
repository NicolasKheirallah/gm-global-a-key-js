import { useState, useRef, useCallback, useEffect } from "react";
import { Plug, Lock, Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { SerialService, type ConnectionState } from "../services/SerialService";

interface HardwareViewProps {
  onSeedFound: (seed: string) => void;
}

/**
 * Format hex value for input fields
 */
const formatHex = (val: string, maxBytes: number): string => {
  const clean = val.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return clean.slice(0, maxBytes * 2);
};

/**
 * Hardware view for direct ECU communication via Web Serial
 */
export function HardwareView({ onSeedFound }: HardwareViewProps) {
  const [logs, setLogs] = useState("");
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [ecuHeader, setEcuHeader] = useState("7E0");
  const [keyToUnlock, setKeyToUnlock] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const serialRef = useRef<SerialService | null>(null);

  // Initialize serial service
  useEffect(() => {
    serialRef.current = new SerialService({
      defaultTimeout: 5000,
      maxRetries: 3,
      debug: true,
    });

    serialRef.current.setHandlers({
      onStateChange: (state) => {
        setConnectionState(state);
        appendLog(`Connection: ${state}`);
      },
      onError: (error) => {
        appendLog(`ERROR: ${error.message}`);
      },
      onData: (_data) => {
        // Raw data logging (optional)
        // appendLog(`RX: ${data}`);
      },
    });

    return () => {
      serialRef.current?.disconnect();
    };
  }, []);

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => `${prev}[${timestamp}] ${message}\n`);
  }, []);

  const handleConnect = async () => {
    try {
      await serialRef.current?.connect();
      appendLog("Connected to serial device");
    } catch (e) {
      appendLog(
        `Connection failed: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  const handleDisconnect = async () => {
    await serialRef.current?.disconnect();
    appendLog("Disconnected");
  };

  const handleScan = async () => {
    if (!serialRef.current || connectionState !== "connected") {
      appendLog("Not connected");
      return;
    }

    setIsScanning(true);
    appendLog("Sending GMLAN Seed Request...");

    try {
      const result = await serialRef.current.executeSeedRequest(ecuHeader);
      appendLog(result.log);

      // Parse seed from response
      const seedMatch = /67\s*0?1\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i.exec(
        result.seed
      );

      if (seedMatch) {
        const fullSeed = `${seedMatch[1]}${seedMatch[2]}`;
        appendLog(`SUCCESS: Extracted Seed ${fullSeed}`);
        onSeedFound(fullSeed);
      } else {
        // Try 5-byte SA015 seed
        const seed5Match =
          /67\s*0?1\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})\s*([0-9A-F]{2})/i.exec(
            result.seed
          );

        if (seed5Match) {
          const fullSeed = `${seed5Match[1]}${seed5Match[2]}${seed5Match[3]}${seed5Match[4]}${seed5Match[5]}`;
          appendLog(`SUCCESS: Extracted 5-byte Seed ${fullSeed}`);
          onSeedFound(fullSeed);
        } else {
          appendLog("FAILED: No seed found in response");
          appendLog(`Response was: ${result.seed}`);
        }
      }
    } catch (e) {
      appendLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsScanning(false);
    }
  };

  const handleUnlock = async () => {
    if (!serialRef.current || connectionState !== "connected") {
      appendLog("Not connected");
      return;
    }

    if (keyToUnlock.length !== 4 && keyToUnlock.length !== 10) {
      alert(
        "Key must be 4 hex characters (2 bytes) or 10 hex characters (5 bytes)"
      );
      return;
    }

    try {
      appendLog(`Sending Key ${keyToUnlock}...`);

      const result =
        keyToUnlock.length === 10
          ? await serialRef.current.sendKey5Byte(keyToUnlock)
          : await serialRef.current.sendKey(keyToUnlock);

      appendLog(result);

      if (result.includes("67 02") || result.includes("6702")) {
        appendLog("SUCCESS: ECU Unlocked!");
        alert("ECU Unlocked!");
      } else if (result.includes("7F 27 35") || result.includes("7F2735")) {
        appendLog("FAILED: Invalid Key (NRC 0x35)");
      } else if (result.includes("7F 27 36") || result.includes("7F2736")) {
        appendLog("FAILED: Exceeded attempts - ECU locked (NRC 0x36)");
      } else if (result.includes("7F 27 37") || result.includes("7F2737")) {
        appendLog("FAILED: Required time delay not expired (NRC 0x37)");
      } else {
        appendLog("FAILED: Incorrect Key or unexpected response");
      }
    } catch (e) {
      appendLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const isConnected = connectionState === "connected";

  return (
    <div className="view">
      <div className="form-group">
        <label>ELM327 / OBD-II Connection (Web Serial)</label>
        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            marginBottom: "0.5rem",
          }}
        >
          <strong>Note:</strong> For J2534 devices (Tactrix, Mongoose), save a
          log and use the <strong>Logs</strong> tab. Direct connection requires
          a serial device (ELM327/STN).
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {connectionState === "disconnected" ? (
            <button
              onClick={handleConnect}
              className="action-btn"
              style={{ flex: 1 }}
            >
              <Plug size={20} />
              Connect USB/Serial
            </button>
          ) : connectionState === "connecting" ? (
            <button className="action-btn" disabled style={{ flex: 1 }}>
              <Loader2 className="animate-spin" size={20} />
              Connecting...
            </button>
          ) : connectionState === "connected" ? (
            <button
              onClick={handleDisconnect}
              className="action-btn"
              style={{ flex: 1, backgroundColor: "#ef4444" }}
            >
              <CheckCircle2 size={20} />
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleConnect}
              className="action-btn"
              style={{ flex: 1, backgroundColor: "#f59e0b" }}
            >
              <XCircle size={20} />
              Reconnect
            </button>
          )}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="ecu-select">Target ECU:</label>
        <select
          id="ecu-select"
          value={ecuHeader}
          onChange={(e) => setEcuHeader(e.target.value)}
        >
          <option value="7E0">ECM (Engine Control Module) - 7E0</option>
          <option value="7E1">TCM (Transmission) - 7E1</option>
          <option value="7E2">FPCM (Fuel Pump) - 7E2</option>
          <option value="241">BCM (Body Control) - 241</option>
          <option value="244">EBCM (Electronic Brake) - 244</option>
          <option value="24A">SDM (Airbag) - 24A</option>
          <option value="248">IPC (Instrument Cluster) - 248</option>
        </select>
      </div>

      <button
        onClick={handleScan}
        disabled={!isConnected || isScanning}
        style={{ marginBottom: "0" }}
      >
        {isScanning ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <Lock size={20} />
        )}
        {isScanning ? "Reading..." : "Read Seed (27 01)"}
      </button>

      <div
        className="form-group"
        style={{
          marginTop: "1rem",
          borderTop: "1px solid var(--border-color)",
          paddingTop: "1rem",
        }}
      >
        <label htmlFor="unlock-key">Unlock (Send Key):</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            id="unlock-key"
            value={keyToUnlock}
            onChange={(e) => setKeyToUnlock(formatHex(e.target.value, 5))}
            placeholder="2-byte (A1B2) or 5-byte (0F8323EB68)"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={handleUnlock}
            disabled={!isConnected || !keyToUnlock}
            className="action-btn"
            style={{ minWidth: "100px" }}
          >
            <Lock size={16} />
            Unlock
          </button>
        </div>
      </div>

      <div className="result-area" style={{ marginTop: "1rem" }}>
        <label>Terminal Log:</label>
        <pre
          style={{
            maxHeight: "250px",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {logs || "Waiting for connection..."}
        </pre>
      </div>
    </div>
  );
}
