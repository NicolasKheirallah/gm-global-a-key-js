import { useState } from "react";
import { Search } from "lucide-react";
import { LogParser, type LogEntry } from "../core";

interface LogParserViewProps {
  onSeedFound: (seed: string) => void;
}

/**
 * Log parser view for extracting seed/key pairs from diagnostic logs
 */
export function LogParserView({ onSeedFound }: LogParserViewProps) {
  const [data, setData] = useState("");
  const [results, setResults] = useState<LogEntry[]>([]);
  const [logFormat, setLogFormat] = useState<string | null>(null);

  const handleParse = () => {
    try {
      const parsed = LogParser.parse(data, { debug: false });
      const format = LogParser.detectLogFormat(data);

      if (parsed.length === 0) {
        alert(
          "No valid Seed/Key sequences found.\n\nLooking for:\n- GMLAN: 67 01 XX XX (seed) / 27 02 XX XX (key)\n- SA015: 67 01 XX XX XX XX XX (seed) / 27 02 XX XX XX XX XX (key)"
        );
      }

      setResults(parsed);
      setLogFormat(format);
    } catch (e) {
      alert(
        "Error parsing log: " + (e instanceof Error ? e.message : String(e))
      );
    }
  };

  const handleUseSeed = (entry: LogEntry) => {
    const seedHex = LogParser.formatSeed(entry);
    onSeedFound(seedHex);
  };

  return (
    <div className="view">
      <div className="form-group">
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
            width: "100%",
            height: "150px",
            fontFamily: "monospace",
            padding: "0.5rem",
            resize: "vertical",
          }}
          spellCheck={false}
        />
      </div>

      <button onClick={handleParse} disabled={!data.trim()}>
        <Search size={20} />
        Find Seeds & Keys
      </button>

      {results.length > 0 && (
        <div className="result-area">
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
                const seedHex = LogParser.formatSeed(entry);
                const keyHex = LogParser.formatKey(entry);
                const moduleName = entry.moduleName || entry.canId || "";
                const levelName = LogParser.getSecurityLevelName(
                  entry.securityLevel
                );

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
              const seedHex = LogParser.formatSeed(entry);
              return (
                <button
                  key={i}
                  onClick={() => handleUseSeed(entry)}
                  style={{
                    fontSize: "0.8rem",
                    padding: "0.25rem 0.5rem",
                    margin: 0,
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
