import { useState, useCallback, useEffect, useRef } from "react";
import { Cpu, Lock, FileText, Plug, Activity } from "lucide-react";
import styles from "./App.module.css";
/* Global styles for resets/variables only */
import "./App.css";
import { useTheme } from "./hooks/useTheme";
import {
  ThemeToggle,
  GMLANView,
  SA015View,
  LogParserView,
  HardwareView,
  UDSView,
} from "./components";
import { ToastProvider } from "./components/ui/Toast";
import { SerialService } from "./services/SerialService";

/**
 * Active tab type
 */
type TabId = "gmlan" | "sa015" | "logs" | "hw" | "uds";

/**
 * Tab configuration
 */
const TABS: Array<{ id: TabId; label: string; icon: typeof Cpu }> = [
  { id: "gmlan", label: "Legacy", icon: Cpu },
  { id: "sa015", label: "SA015", icon: Lock },
  { id: "logs", label: "Logs", icon: FileText },
  { id: "hw", label: "Hardware", icon: Plug },
  { id: "uds", label: "UDS", icon: Activity },
];

/**
 * Main application component
 */
function App() {
  const [activeTab, setActiveTab] = useState<TabId>("gmlan");
  const [sharedSeed, setSharedSeed] = useState("");
  const { isDarkMode, toggleTheme } = useTheme();

  // Shared Serial Service
  const serialRef = useRef<SerialService | null>(null);

  // Initialize serial service once
  if (!serialRef.current) {
    serialRef.current = new SerialService({
      defaultTimeout: 5000,
      maxRetries: 3,
      debug: true,
    });
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      serialRef.current?.disconnect();
    };
  }, []);

  /**
   * Handle seed found from log parser or hardware view
   * Auto-switches to appropriate calculator based on seed length
   */
  const handleFoundSeed = useCallback((seed: string) => {
    setSharedSeed(seed);
    // 2 bytes (4 chars) -> GMLAN, 5 bytes (10 chars) -> SA015
    if (seed.length <= 4) {
      setActiveTab("gmlan");
    } else {
      setActiveTab("sa015");
    }
  }, []);

  return (
    <ToastProvider>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>
            GM Key Tools
            <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />
          </h1>
        </header>

        <nav
          className={styles.tabs}
          role="tablist"
          aria-label="Key Calculator Modes"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              className={`${styles.tab} ${
                activeTab === id ? styles.tabActive : ""
              }`}
              onClick={() => setActiveTab(id)}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <main className={styles.content}>
          <div
            id="panel-gmlan"
            role="tabpanel"
            aria-labelledby="tab-gmlan"
            hidden={activeTab !== "gmlan"}
          >
            {activeTab === "gmlan" && <GMLANView sharedSeed={sharedSeed} />}
          </div>

          <div
            id="panel-sa015"
            role="tabpanel"
            aria-labelledby="tab-sa015"
            hidden={activeTab !== "sa015"}
          >
            {activeTab === "sa015" && <SA015View sharedSeed={sharedSeed} />}
          </div>

          <div
            id="panel-logs"
            role="tabpanel"
            aria-labelledby="tab-logs"
            hidden={activeTab !== "logs"}
          >
            {activeTab === "logs" && (
              <LogParserView onSeedFound={handleFoundSeed} />
            )}
          </div>

          <div
            id="panel-hw"
            role="tabpanel"
            aria-labelledby="tab-hw"
            hidden={activeTab !== "hw"}
          >
            <div style={{ display: activeTab === "hw" ? "block" : "none" }}>
              <HardwareView
                onSeedFound={handleFoundSeed}
                serialService={serialRef.current!}
              />
            </div>
          </div>

          <div
            id="panel-uds"
            role="tabpanel"
            aria-labelledby="tab-uds"
            hidden={activeTab !== "uds"}
          >
            <div style={{ display: activeTab === "uds" ? "block" : "none" }}>
              <UDSView serialService={serialRef.current!} />
            </div>
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
