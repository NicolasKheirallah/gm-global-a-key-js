/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import styles from "./Toast.module.css";

import { type Toast, type ToastType } from "../../types/toast";

interface ToastContextType {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev, { id, message, type }]);

      // Auto-remove after 5 seconds
      setTimeout(() => {
        removeToast(id);
      }, 5000);
    },
    [removeToast]
  );

  const info = useCallback((msg: string) => addToast(msg, "info"), [addToast]);
  const success = useCallback(
    (msg: string) => addToast(msg, "success"),
    [addToast]
  );
  const warning = useCallback(
    (msg: string) => addToast(msg, "warning"),
    [addToast]
  );
  const error = useCallback(
    (msg: string) => addToast(msg, "error"),
    [addToast]
  );

  return (
    <ToastContext.Provider
      value={{ toasts, addToast, removeToast, info, success, warning, error }}
    >
      {children}
      <div className={styles.toastContainer}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type]}`}
          >
            {toast.type === "success" && <CheckCircle size={20} />}
            {toast.type === "error" && <AlertCircle size={20} />}
            {toast.type === "warning" && <AlertTriangle size={20} />}
            {toast.type === "info" && <Info size={20} />}

            <span className={styles.content}>{toast.message}</span>

            <button
              onClick={() => removeToast(toast.id)}
              className={styles.closeButton}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
