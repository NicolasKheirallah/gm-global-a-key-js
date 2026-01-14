import { useState, useEffect } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import styles from "./View.module.css";
import { useSessionStorage } from "../hooks/useSessionStorage";
import { SA015Engine, Utils } from "../core";

interface SA015ViewProps {
  sharedSeed: string;
}

type AlgoFormat = "hex" | "dec";

/**
 * Format hex value for input fields
 */
const formatHex = (val: string, maxBytes: number): string => {
  const clean = val.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  return clean.slice(0, maxBytes * 2);
};

const formatDec = (val: string, maxDigits: number): string => {
  const clean = val.replace(/\D/g, "");
  return clean.slice(0, maxDigits);
};

/**
 * SA015 (5-byte) key calculator view
 */
export function SA015View({ sharedSeed }: SA015ViewProps) {
  const [seed, setSeed] = useSessionStorage("sa015_seed", sharedSeed);
  const [algo, setAlgo] = useSessionStorage("sa015_algo", "");
  const [algoFormat, setAlgoFormat] = useSessionStorage<AlgoFormat>(
    "sa015_algo_format",
    "hex"
  );
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  // Sync with shared seed from other views
  useEffect(() => {
    if (sharedSeed) setSeed(sharedSeed);
  }, [sharedSeed, setSeed]);

  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeed(formatHex(e.target.value, 5));
  };

  const handleAlgoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (algoFormat === "dec") {
      setAlgo(formatDec(e.target.value, 5));
      return;
    }
    setAlgo(formatHex(e.target.value, 1));
  };

  const handleCalculate = async () => {
    try {
      setError("");
      setResult(null);
      setProgress(null);
      setLoading(true);

      const seedBytes = Utils.normalizeSeed(seed, 5);
      const algoId =
        algoFormat === "dec" ? parseInt(algo, 10) : parseInt(algo, 16);

      if (isNaN(algoId)) throw new Error("Invalid Algorithm ID");
      if (algoId < 0 || algoId > 0xffff) {
        throw new Error("Algorithm ID must be 0-65535");
      }

      // Use Web Worker for SA015 calculation
      const worker = new Worker(new URL("../worker.ts", import.meta.url), {
        type: "module",
      });

      worker.postMessage({
        type: "SA015_CALCULATE",
        algo: algoId,
        seedBytes: seedBytes,
      });

      worker.onmessage = (e: MessageEvent) => {
        const { type, current, total, result, message } = e.data;

        if (type === "SA015_PROGRESS") {
          setProgress({ current, total });
        } else if (type === "SA015_RESULT") {
          const hexKey = SA015Engine.formatKey(result);
          setResult(
            `Key: ${hexKey}\nIterations: ${result.iterations}\nPrefix: ${result.prefix}`
          );
          setLoading(false);
          worker.terminate();
        } else if (type === "ERROR") {
          setError(message ?? "Unknown error");
          setLoading(false);
          worker.terminate();
        }
      };

      worker.onerror = (e) => {
        setLoading(false);
        setError(`Worker error: ${e.message}`);
        worker.terminate();
      };
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.view}>
      <div className={styles.formGroup}>
        <label htmlFor="sa015-seed">Seed (5 bytes, hex):</label>
        <input
          id="sa015-seed"
          value={seed}
          onChange={handleSeedChange}
          placeholder="8CE7D1FD06"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="sa015-algo">Algorithm ID:</label>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            id="sa015-algo"
            value={algo}
            onChange={handleAlgoChange}
            placeholder={algoFormat === "dec" ? "135" : "87"}
            maxLength={algoFormat === "dec" ? 5 : 2}
            autoComplete="off"
            spellCheck={false}
          />
          <select
            value={algoFormat}
            onChange={(e) =>
              setAlgoFormat(e.target.value as AlgoFormat)
            }
          >
            <option value="hex">Hex</option>
            <option value="dec">Dec</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleCalculate}
        disabled={loading || !seed || !algo}
        className={styles.button}
      >
        {loading ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <ArrowRight size={20} />
        )}
        {loading
          ? progress
            ? `Calculating... ${Math.round(
                (progress.current / progress.total) * 100
              )}%`
            : "Calculating..."
          : "Calculate"}
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
