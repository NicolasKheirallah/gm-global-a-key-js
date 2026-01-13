import { GMLANEngine, table_gmlan, table_others, table_class2 } from "./core";

type TableType = "gmlan" | "others" | "class2";

self.onmessage = (e: MessageEvent<{ seedInt: number; table: TableType }>) => {
  const { seedInt, table } = e.data;

  try {
    let tableData = table_gmlan;
    if (table === "others") tableData = table_others;
    if (table === "class2") tableData = table_class2;

    const results = GMLANEngine.bruteForceAll(seedInt, tableData);
    self.postMessage({ type: "result", results });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
};
