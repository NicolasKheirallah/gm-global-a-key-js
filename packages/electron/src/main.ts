import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import isDev from "electron-is-dev";

/**
 * Store for allowed serial ports (persisted during session)
 */
const allowedPorts: Set<string> = new Set();

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 480,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for Web Serial API
    },
    backgroundColor: "#f3f4f6",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
  });

  // Handle Web Serial API port selection
  // This shows the native Electron port picker dialog
  mainWindow.webContents.session.on(
    "select-serial-port",
    (event, portList, webContents, callback) => {
      event.preventDefault();

      // If no ports available
      if (!portList || portList.length === 0) {
        console.log("No serial ports available");
        callback(""); // Return empty to indicate no selection
        return;
      }

      // Log available ports for debugging
      console.log(
        "Available serial ports:",
        portList.map((p) => ({
          portId: p.portId,
          portName: p.portName,
          displayName: p.displayName,
        }))
      );

      // Check if any port was previously allowed (auto-reconnect)
      const previouslyAllowed = portList.find((port) =>
        allowedPorts.has(port.portId)
      );

      if (previouslyAllowed) {
        console.log(
          "Auto-selecting previously allowed port:",
          previouslyAllowed.portId
        );
        callback(previouslyAllowed.portId);
        return;
      }

      // For first-time selection, let the user choose
      // Electron will show its native port picker dialog
      // We need to handle this via webContents.session events

      // Show port list to user via IPC if needed
      // For now, we'll use the first matching device but filter by known VIDs
      const knownVendorIds = [
        0x0403, // FTDI
        0x10c4, // Silicon Labs
        0x1a86, // CH340
        0x067b, // Prolific
      ];

      // Try to find a known OBD device
      const obdPort = portList.find((port) => {
        // Check vendor ID if available (convert string to number for comparison)
        const portVendorId =
          typeof port.vendorId === "string"
            ? parseInt(port.vendorId, 16)
            : port.vendorId;
        const vendorMatch =
          portVendorId !== undefined && knownVendorIds.includes(portVendorId);
        // Also check display name for common OBD adapters
        const nameMatch =
          port.displayName?.toLowerCase().includes("obd") ||
          port.displayName?.toLowerCase().includes("elm") ||
          port.displayName?.toLowerCase().includes("stn") ||
          port.portName?.toLowerCase().includes("usb");

        return vendorMatch || nameMatch;
      });

      if (obdPort) {
        console.log(
          "Found OBD adapter, prompting user:",
          obdPort.displayName || obdPort.portName
        );
        // Still return empty to trigger user prompt in newer Electron versions
        // The user will see the native dialog
        callback(obdPort.portId);
        allowedPorts.add(obdPort.portId);
      } else {
        // No known OBD device, let user choose from native dialog
        // Return empty string to trigger the picker
        console.log("No known OBD adapter found, showing picker");
        callback("");
      }
    }
  );

  // Track when ports are added
  mainWindow.webContents.session.on("serial-port-added", (event, port) => {
    console.log("Serial port added:", {
      portId: port.portId,
      portName: port.portName,
      displayName: port.displayName,
    });
  });

  // Track when ports are removed
  mainWindow.webContents.session.on("serial-port-removed", (event, port) => {
    console.log("Serial port removed:", port.portId);
    allowedPorts.delete(port.portId);
  });

  // Permission check handler
  mainWindow.webContents.session.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (permission === "serial") {
        // Allow serial permission checks
        return true;
      }
      // Deny other permissions by default
      return false;
    }
  );

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === "serial") {
      // Track allowed devices - use type assertion for serial port
      const device = details.device as { portId?: string };
      if (device?.portId) {
        allowedPorts.add(device.portId);
      }
      return true;
    }
    return false;
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load the built web app
    const webDistPath = path.join(__dirname, "../../web/dist/index.html");
    console.log("Loading production build from:", webDistPath);
    mainWindow.loadFile(webDistPath);
  }

  // Handle window ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
}

// IPC handlers for serial port management
ipcMain.handle("serial:get-allowed-ports", () => {
  return Array.from(allowedPorts);
});

ipcMain.handle("serial:clear-allowed-ports", () => {
  allowedPorts.clear();
  return true;
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    // On macOS, recreate window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Security: Prevent navigation and new windows
app.on("web-contents-created", (event, contents) => {
  contents.on("will-navigate", (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    // Only allow localhost in dev or file:// in production
    if (
      !isDev &&
      parsedUrl.protocol !== "file:" &&
      parsedUrl.origin !== "null"
    ) {
      event.preventDefault();
    }
  });

  contents.setWindowOpenHandler(({ url }) => {
    // Open external links in default browser
    if (url.startsWith("http")) {
      require("electron").shell.openExternal(url);
    }
    return { action: "deny" };
  });
});
