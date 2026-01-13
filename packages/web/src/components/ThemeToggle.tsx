import { Sun, Moon } from "lucide-react";

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
      className={`theme-toggle ${isDarkMode ? "dark" : ""}`}
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
      <div className="theme-toggle-thumb">
        {isDarkMode ? <Moon size={14} /> : <Sun size={14} />}
      </div>
      <div className="theme-icon-slot sun" aria-hidden="true">
        <Sun size={14} />
      </div>
      <div className="theme-icon-slot moon" aria-hidden="true">
        <Moon size={14} />
      </div>
    </div>
  );
}
