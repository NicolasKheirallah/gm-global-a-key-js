import { useState, useEffect } from "react";
import { Search, Loader2 } from "lucide-react";
import styles from "./View.module.css";
import { useSessionStorage } from "../hooks/useSessionStorage";
import {
  GMLANEngine,
  Utils,
  table_gmlan,
  table_others,
  table_class2,
} from "../core";

type TableType = "gmlan" | "others" | "class2";

interface GMLANViewProps {
  sharedSeed: string;
}

/**
 * Format hex value for input fields
 */
const formatHex = (val: string, maxBytes: number): string => {
  const clean = val.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return clean.slice(0, maxBytes * 2);
};

/**
 * GMLAN (Legacy 16-bit) key calculator view
 */
export function GMLANView({ sharedSeed }: GMLANViewProps) {
  const [seed, setSeed] = useSessionStorage("gmlan_seed", sharedSeed);
  const [algo, setAlgo] = useSessionStorage("gmlan_algo", "");
  const [table, setTable] = useSessionStorage<TableType>(
    "gmlan_table",
    "gmlan"
  );
  const [isBrute, setIsBrute] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Sync with shared seed from other views
  useEffect(() => {
    if (sharedSeed) setSeed(sharedSeed);
  }, [sharedSeed, setSeed]);

  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeed(formatHex(e.target.value, 2));
  };

  const handleAlgoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAlgo(formatHex(e.target.value, 1));
  };

  const handleCalculate = async () => {
    try {
      setError("");
      setResult("");

      const seedBytes = Utils.normalizeSeed(seed, 2);
      const seedInt = Utils.bytesToInt(seedBytes);

      if (isBrute) {
        setLoading(true);

        // Use Web Worker for brute force to prevent UI freeze
        const worker = new Worker(new URL("../worker.ts", import.meta.url), {
          type: "module",
        });

        worker.postMessage({ type: "GMLAN_BRUTE_FORCE", seedInt, table });

        worker.onmessage = (e: MessageEvent) => {
          setLoading(false);
          const { type, results, message } = e.data;

          if (type === "ERROR") {
            setError(message ?? "Unknown error");
          } else if (type === "GMLAN_RESULT") {
            if (!results || results.length === 0) {
              setResult("No keys found.");
            } else {
              setResult(
                results
                  .map(
                    (r: { algo: number; key: number }) =>
                      `Algo 0x${r.algo
                        .toString(16)
                        .toUpperCase()
                        .padStart(2, "0")}: Key 0x${r.key
                        .toString(16)
                        .toUpperCase()
                        .padStart(4, "0")}`
                  )
                  .join("\n")
              );
            }
          }
          worker.terminate();
        };

        worker.onerror = (e) => {
          setLoading(false);
          setError(`Worker error: ${e.message}`);
          worker.terminate();
        };
      } else {
        const algoId = parseInt(algo, 16);
        if (isNaN(algoId)) throw new Error("Invalid Algorithm ID");

        let tableData = table_gmlan;
        if (table === "others") tableData = table_others;
        if (table === "class2") tableData = table_class2;

        const key = GMLANEngine.getKey(seedInt, algoId, tableData);
        setResult(`Key: 0x${key.toString(16).toUpperCase().padStart(4, "0")}`);
      }
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.view}>
      <div className={styles.formGroup}>
        <label htmlFor="gmlan-seed">Seed (2 bytes, hex):</label>
        <input
          id="gmlan-seed"
          value={seed}
          onChange={handleSeedChange}
          placeholder="A1B2"
          maxLength={4}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.checkbox}>
        <label>
          <input
            type="checkbox"
            checked={isBrute}
            onChange={(e) => setIsBrute(e.target.checked)}
          />
          Brute Force All Algorithms
        </label>
      </div>

      {!isBrute && (
        <div className={styles.formGroup}>
          <label htmlFor="gmlan-algo">Algorithm ID (hex):</label>
          <input
            id="gmlan-algo"
            value={algo}
            onChange={handleAlgoChange}
            placeholder="12"
            maxLength={2}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}

      <div className={styles.formGroup}>
        <label htmlFor="gmlan-table">Table:</label>
        <select
          id="gmlan-table"
          value={table}
          onChange={(e) => setTable(e.target.value as TableType)}
        >
          <option value="gmlan">GMLAN</option>
          <option value="others">Others</option>
          <option value="class2">Class2</option>
        </select>
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading || !seed}
        className={styles.button}
      >
        {loading ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <Search size={20} />
        )}
        {loading ? "Searching..." : "Calculate"}
      </button>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className={styles.resultArea}>
          <label>Result:</label>
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}
