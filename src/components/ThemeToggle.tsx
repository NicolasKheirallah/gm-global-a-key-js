import { Sun, Moon } from "lucide-react";
import styles from "../App.module.css";

interface ThemeToggleProps {
  isDarkMode: boolean;
  onToggle: () => void;
}

/**
 * Accessible theme toggle switch component
 */
export function ThemeToggle({ isDarkMode, onToggle }: ThemeToggleProps) {
  return (
    <div
      className={`${styles.themeToggle} ${
        isDarkMode ? styles.themeToggleDark : ""
      }`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      title={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      role="switch"
      aria-checked={isDarkMode}
      aria-label="Toggle dark mode"
      tabIndex={0}
    >
      <div className={styles.themeToggleThumb}>
        {isDarkMode ? <Moon size={14} /> : <Sun size={14} />}
      </div>
      <div
        className={`${styles.themeIconSlot} ${styles.sun}`}
        aria-hidden="true"
      >
        <Sun size={14} />
      </div>
      <div
        className={`${styles.themeIconSlot} ${styles.moon}`}
        aria-hidden="true"
      >
        <Moon size={14} />
      </div>
    </div>
  );
}
