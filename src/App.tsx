import { useState, useRef, useEffect, useCallback } from "react";
import { Cpu, Lock, FileText, Plug, Activity, Layers } from "lucide-react";
import styles from "./App.module.css";
/* Global styles for resets only */
import "./App.css";
import { useTheme } from "./hooks/useTheme";
import { ThemeToggle } from "./components/ThemeToggle";
import {
  GMLANView,
  SA015View,
  LogParserView,
  HardwareView,
  UDSView,
} from "./components";
import { ToastProvider } from "./components/ui/Toast";
import { SerialService } from "./services/SerialService";
import { J2534Service } from "./services/J2534Service";
import type { HardwareService } from "./services/HardwareService";

const isTauri = () => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

type TabId = "gmlan" | "sa015" | "logs" | "hw" | "uds";

const TABS: Array<{ id: TabId; label: string; icon: typeof Cpu }> = [
  { id: "hw", label: "Hardware & Connection", icon: Plug },
  { id: "gmlan", label: "Legacy (GMLAN)", icon: Layers },
  { id: "sa015", label: "Global A (SA015)", icon: Lock },
  { id: "uds", label: "UDS Diagnostics", icon: Activity },
  { id: "logs", label: "Log Analysis", icon: FileText },
];

function App() {
  const { isDarkMode, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("hw");
  const [sharedSeed, setSharedSeed] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  // Shared Hardware Service
  const serviceRef = useRef<HardwareService | null>(null);

  // Initialize service once
  if (!serviceRef.current) {
    if (isTauri()) {
      serviceRef.current = new J2534Service();
    } else {
      serviceRef.current = new SerialService({
        defaultTimeout: 5000,
        maxRetries: 3,
        debug: true,
      });
    }
  }

  // Subscribe to connection state
  useEffect(() => {
    // Poll for connection state or setup listeners
    // For this prototype, we'll let HardwareView manage exact state updates for now
    // but we can poll serviceRef.current.isConnected if needed for the status bar
    const interval = setInterval(() => {
      if (serviceRef.current) {
        setIsConnected(serviceRef.current.isConnected);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleFoundSeed = useCallback((seed: string) => {
    setSharedSeed(seed);
    if (seed.length <= 4) {
      setActiveTab("gmlan");
    } else {
      setActiveTab("sa015");
    }
  }, []);

  const activeTabLabel = TABS.find((t) => t.id === activeTab)?.label;

  return (
    <ToastProvider>
      <div className={styles.layout}>
        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.brand}>
            <h1>GM Key Tools</h1>
            <span className={styles.brandSub}>Global A Diagnostic Utility</span>
          </div>

          <nav className={styles.nav}>
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`${styles.navItem} ${
                  activeTab === id ? styles.navItemActive : ""
                }`}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={20} className={styles.navIcon} />
                {label}
              </button>
            ))}
          </nav>

          {/* Version / Info Footer */}
          <div
            style={{
              marginTop: "auto",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
            }}
          >
            v1.1.0-alpha <br />
            {isTauri() ? "Native Mode (J2534)" : "Web Mode (Serial)"}
          </div>
        </aside>

        {/* Main Content */}
        <main className={styles.main}>
          {/* Header */}
          <header className={styles.header}>
            <div className={styles.headerTitle}>{activeTabLabel}</div>
            <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />
          </header>

          {/* Scrollable Area */}
          <div className={styles.contentScroll}>
            <div className={styles.contentInner}>
              <div hidden={activeTab !== "gmlan"}>
                <GMLANView sharedSeed={sharedSeed} />
              </div>
              <div hidden={activeTab !== "sa015"}>
                <SA015View sharedSeed={sharedSeed} />
              </div>
              <div hidden={activeTab !== "logs"}>
                <LogParserView onSeedFound={handleFoundSeed} />
              </div>
              <div hidden={activeTab !== "hw"}>
                <HardwareView
                  onSeedFound={handleFoundSeed}
                  serialService={serviceRef.current!}
                />
              </div>
              <div hidden={activeTab !== "uds"}>
                <UDSView serialService={serviceRef.current!} />
              </div>
            </div>
          </div>

          {/* Status Bar */}
          <footer className={styles.statusBar}>
            <div className={styles.statusItem}>
              <div
                className={`${styles.indicator} ${
                  isConnected ? styles.connected : ""
                }`}
              />
              {isConnected ? "DEVICE CONNECTED" : "NO DEVICE"}
            </div>
            <div className={styles.statusItem}>PROTOCOL: AUTO</div>
            <div className={styles.statusItem} style={{ marginLeft: "auto" }}>
              {new Date().toLocaleDateString()}
            </div>
          </footer>
        </main>
      </div>
    </ToastProvider>
  );
}

export default App;
