import { useState } from "react";
import { FileSearch, Play, Loader2 } from "lucide-react";
import { UDSMessage } from "../core";
import { SerialService } from "../services/SerialService";
import { useSessionStorage } from "../hooks/useSessionStorage";
import styles from "./View.module.css";

interface UDSViewProps {
  serialService: SerialService;
}

/**
 * Advanced UDS interactions view
 */
export function UDSView({ serialService }: UDSViewProps) {
  const [did, setDid] = useSessionStorage("uds_did", "F190");
  const [routineId, setRoutineId] = useSessionStorage("uds_routine", "0203");
  const [subFunc, setSubFunc] = useState("01"); // 01=Start, 02=Stop, 03=Result
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const handleReadDid = async () => {
    if (!serialService.isConnected) {
      addLog("Error: Not connected to hardware");
      return;
    }

    setLoading(true);
    try {
      const didNum = parseInt(did, 16);
      if (isNaN(didNum)) {
        addLog("Error: Invalid DID");
        return;
      }

      const req = UDSMessage.buildReadDataByIdentifier(didNum);
      const hexReq = UDSMessage.formatBytes(req).replace(/\s/g, "");

      addLog(`TX: ${hexReq} (Read DID ${did})`);
      const resp = await serialService.send(hexReq);
      addLog(`RX: ${resp}`);
    } catch (e) {
      addLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRoutine = async () => {
    if (!serialService.isConnected) {
      addLog("Error: Not connected to hardware");
      return;
    }

    setLoading(true);
    try {
      const rid = parseInt(routineId, 16);
      const sub = parseInt(subFunc, 16);
      if (isNaN(rid) || isNaN(sub)) {
        addLog("Error: Invalid Routine ID or SubFunction");
        return;
      }

      const req = UDSMessage.buildRoutineControl(sub, rid);
      const hexReq = UDSMessage.formatBytes(req).replace(/\s/g, "");

      addLog(`TX: ${hexReq} (Routine ${subFunc} ${routineId})`);
      const resp = await serialService.send(hexReq);
      addLog(`RX: ${resp}`);
    } catch (e) {
      addLog(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.view}>
      <div className={styles.card}>
        <h3>Read Data By Identifier (0x22)</h3>
        <div className={styles.formGroup}>
          <label>DID (hex):</label>
          <div className={styles.inputGroup}>
            <input
              value={did}
              onChange={(e) => setDid(e.target.value)}
              placeholder="F190"
              maxLength={4}
            />
            <button
              onClick={handleReadDid}
              disabled={loading}
              className={styles.button}
              style={{ margin: 0 }}
            >
              {loading ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <FileSearch size={16} />
              )}
              Read
            </button>
          </div>
        </div>
      </div>

      <div className={styles.card}>
        <h3>Routine Control (0x31)</h3>
        <div className={styles.formGroup}>
          <div className={styles.row}>
            <div className={styles.col}>
              <label>Routine ID (hex):</label>
              <input
                value={routineId}
                onChange={(e) => setRoutineId(e.target.value)}
                placeholder="0203"
                maxLength={4}
              />
            </div>
            <div className={styles.col}>
              <label>Sub-Function:</label>
              <select
                value={subFunc}
                onChange={(e) => setSubFunc(e.target.value)}
              >
                <option value="01">Start (01)</option>
                <option value="02">Stop (02)</option>
                <option value="03">Result (03)</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleRoutine}
            disabled={loading}
            className={styles.button}
          >
            {loading ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Play size={16} />
            )}
            Execute Routine
          </button>
        </div>
      </div>

      <div className={styles.logsArea}>
        <h4>Operation Log</h4>
        <div className={styles.logsContainer}>
          {logs.map((log, i) => (
            <div key={i}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
