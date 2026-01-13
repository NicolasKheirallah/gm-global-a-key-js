import {
  GMLANEngine,
  table_gmlan,
  table_others,
  table_class2,
  SA015Engine,
  LogParser,
} from "./core";

type GMLANTableType = "gmlan" | "others" | "class2";

// Define message types
type WorkerMessage =
  | { type: "GMLAN_BRUTE_FORCE"; seedInt: number; table: GMLANTableType }
  | { type: "SA015_CALCULATE"; algo: number; seedBytes: Uint8Array }
  | { type: "LOG_PARSE"; data: string };

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  try {
    switch (msg.type) {
      case "GMLAN_BRUTE_FORCE": {
        const { seedInt, table } = msg;
        let tableData = table_gmlan;
        if (table === "others") tableData = table_others;
        if (table === "class2") tableData = table_class2;

        const results = GMLANEngine.bruteForceAll(seedInt, tableData);
        self.postMessage({ type: "GMLAN_RESULT", results });
        break;
      }

      case "SA015_CALCULATE": {
        const { algo, seedBytes } = msg;

        // Progress callback to post updates back to main thread
        const onProgress = (current: number, total: number) => {
          self.postMessage({ type: "SA015_PROGRESS", current, total });
        };

        const result = await SA015Engine.deriveKey(algo, seedBytes, {
          onProgress,
          progressInterval: 100, // Update every 100 iterations
        });

        self.postMessage({ type: "SA015_RESULT", result });
        break;
      }

      case "LOG_PARSE": {
        const { data } = msg;
        const results = LogParser.parse(data);
        const format = LogParser.detectLogFormat(data);
        self.postMessage({ type: "LOG_PARSE_RESULT", results, format });
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "ERROR", message: String(err) });
  }
};
