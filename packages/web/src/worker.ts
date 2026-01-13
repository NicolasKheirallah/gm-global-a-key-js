import {
  GMLANEngine,
  table_gmlan,
  table_others,
  table_class2,
} from "@gm-key/core";

self.onmessage = (e) => {
  const { seedInt, table } = e.data;

  let tableData = table_gmlan;
  if (table === "others") tableData = table_others;
  if (table === "class2") tableData = table_class2;

  try {
    const results = GMLANEngine.bruteForceAll(seedInt, tableData);
    self.postMessage({ type: "success", results });
  } catch (err: any) {
    self.postMessage({ type: "error", message: err.message });
  }
};
