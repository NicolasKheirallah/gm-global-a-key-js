import { useState, useEffect } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { SA015Engine, Utils } from "../core";

interface SA015ViewProps {
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
 * SA015 (5-byte) key calculator view
 */
export function SA015View({ sharedSeed }: SA015ViewProps) {
  const [seed, setSeed] = useState(sharedSeed);
  const [algo, setAlgo] = useState("");
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
  }, [sharedSeed]);

  const handleSeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSeed(formatHex(e.target.value, 5));
  };

  const handleAlgoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAlgo(formatHex(e.target.value, 1));
  };

  const handleCalculate = async () => {
    try {
      setError("");
      setResult(null);
      setProgress(null);
      setLoading(true);

      // Small delay to ensure UI updates
      await new Promise((r) => setTimeout(r, 10));

      const seedBytes = Utils.normalizeSeed(seed, 5);
      const algoId = parseInt(algo, 16);

      if (isNaN(algoId)) throw new Error("Invalid Algorithm ID");

      const res = await SA015Engine.deriveKey(algoId, seedBytes, {
        onProgress: (current, total) => {
          setProgress({ current, total });
        },
        progressInterval: 5,
      });

      const hexKey = SA015Engine.formatKey(res);

      setResult(
        `Key: ${hexKey}\nIterations: ${res.iterations}\nPrefix: ${res.prefix}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <div className="view">
      <div className="form-group">
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

      <div className="form-group">
        <label htmlFor="sa015-algo">Algorithm ID (hex):</label>
        <input
          id="sa015-algo"
          value={algo}
          onChange={handleAlgoChange}
          placeholder="87"
          maxLength={2}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <button onClick={handleCalculate} disabled={loading || !seed || !algo}>
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
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <div className="result-area">
          <label>Result:</label>
          <pre>{result}</pre>
        </div>
      )}
    </div>
  );
}
