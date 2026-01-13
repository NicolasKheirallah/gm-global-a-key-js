import { useState, useEffect, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { type LogEntry } from "../core";
import { useToast } from "./ui/Toast";
import styles from "./View.module.css";

interface LogParserViewProps {
  onSeedFound: (seed: string) => void;
}

/**
 * Log parser view for extracting seed/key pairs from diagnostic logs
 * Uses Web Worker for non-blocking parsing
 */
export function LogParserView({ onSeedFound }: LogParserViewProps) {
  const [data, setData] = useState("");
  const [results, setResults] = useState<LogEntry[]>([]);
  const [logFormat, setLogFormat] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const { error, success, info } = useToast();

  useEffect(() => {
    // Initialize worker
    workerRef.current = new Worker(new URL("../worker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "LOG_PARSE_RESULT") {
        setIsParsing(false);
        const { results, format } = msg;

        if (results.length === 0) {
          info("No valid Seed/Key sequences found. Check log format.");
        } else {
          success(`Found ${results.length} pairs!`);
          setResults(results);
          setLogFormat(format);
        }
      } else if (msg.type === "ERROR") {
        setIsParsing(false);
        error(`Worker Error: ${msg.message}`);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, [error, success, info]);

  const handleParse = () => {
    if (!data.trim()) return;

    setIsParsing(true);
    setResults([]);
    setLogFormat(null);

    // Offload to worker
    workerRef.current?.postMessage({
      type: "LOG_PARSE",
      data: data,
    });
  };

  const handleUseSeed = (entry: LogEntry) => {
    // Helper to format seed string locally since LogParser static methods aren't in worker
    // We can duplicate the logic or import the static helper.
    // Since we import LogEntry type, we can import LogParser static helpers too.
    import("../core").then(({ LogParser }) => {
      const seedHex = LogParser.formatSeed(entry);
      onSeedFound(seedHex);
    });
  };

  return (
    <div className={styles.view}>
      <div className={styles.formGroup}>
        <label htmlFor="log-input">Paste Logic Analyzer / CAN Log:</label>
        <textarea
          id="log-input"
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder={`Paste log here. Supported formats:
- J2534 logs
- ELM327 output
- Tech2Win logs
- GDS2 logs

Looking for:
  67 01 XX XX (2-byte seed)
  67 01 XX XX XX XX XX (5-byte seed)
  27 02 XX XX (2-byte key)
  27 02 XX XX XX XX XX (5-byte key)`}
          style={{
            height: "150px",
          }}
          spellCheck={false}
          disabled={isParsing}
        />
      </div>

      <button
        onClick={handleParse}
        disabled={!data.trim() || isParsing}
        className={styles.button}
      >
        {isParsing ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <Search size={20} />
        )}
        {isParsing ? "Parsing..." : "Find Seeds & Keys"}
      </button>

      {results.length > 0 && (
        <div className={styles.resultArea}>
          <label>
            Found {results.length} pair{results.length !== 1 ? "s" : ""}
            {logFormat && logFormat !== "UNKNOWN" && (
              <span style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                (Detected: {logFormat})
              </span>
            )}
          </label>
          <pre>
            {results
              .map((entry, i) => {
                // We need to render this synchronously, so we need access to formatting logic.
                const seedHex = entry.seedBytes
                  ? Array.from(entry.seedBytes)
                      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
                      .join(" ")
                  : entry.seed.toString(16).toUpperCase().padStart(4, "0");

                const keyHex = entry.keyBytes
                  ? Array.from(entry.keyBytes)
                      .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
                      .join(" ")
                  : entry.key.toString(16).toUpperCase().padStart(4, "0");

                const moduleName = entry.moduleName || entry.canId || "";
                // Simple level mapping
                const levelName =
                  entry.securityLevel === 0x01
                    ? "Standard (01)"
                    : entry.securityLevel === 0x11
                    ? "Programming (11)"
                    : `Level ${entry.securityLevel
                        .toString(16)
                        .toUpperCase()
                        .padStart(2, "0")}`;

                return `[${i + 1}] ${entry.protocol}${
                  moduleName ? ` (${moduleName})` : ""
                }
    Seed: ${seedHex}
    Key:  ${keyHex}
    Level: ${levelName}`;
              })
              .join("\n\n")}
          </pre>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.5rem",
              marginTop: "0.75rem",
            }}
          >
            {results.map((entry, i) => {
              const seedHex = entry.seedBytes
                ? Array.from(entry.seedBytes)
                    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
                    .join("")
                : entry.seed.toString(16).toUpperCase().padStart(4, "0");
              return (
                <button
                  key={i}
                  onClick={() => handleUseSeed(entry)}
                  className={styles.button}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.25rem 0.5rem",
                    margin: 0,
                    width: "auto",
                  }}
                  title={`Use this seed in the ${entry.protocol} calculator`}
                >
                  Use {seedHex.substring(0, 8)}
                  {seedHex.length > 8 ? "..." : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
