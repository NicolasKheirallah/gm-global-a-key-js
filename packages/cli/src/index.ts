#!/usr/bin/env node
/// <reference types="node" />
import { Command } from "commander";
import inquirer from "inquirer";
import {
  Utils,
  GMLANEngine,
  SA015Engine,
  table_gmlan,
  table_others,
  table_class2,
  LogParser,
} from "@gm-key/core";

const program = new Command();

program
  .name("gm-tool")
  .description("GM Key Tools - Node.js CLI")
  .version("1.0.0")
  .option("--json", "Output results as JSON");

async function runInteractive() {
  const answerType = await inquirer.prompt([
    {
      type: "list",
      name: "mode",
      message: "Select Operation:",
      choices: [
        "GMLAN (16-bit)",
        "SA015 (5-byte)",
        "Find Algo (Reverse Force)",
      ],
    },
  ]);

  if (answerType.mode.startsWith("GMLAN")) {
    const answers = await inquirer.prompt([
      { name: "seed", message: "Seed (4 hex digits):", default: "D435" },
      { name: "algo", message: "Algo ID (hex):", default: "89" },
      {
        type: "list",
        name: "table",
        message: "Table:",
        choices: ["gmlan", "others", "class2"],
      },
    ]);
    runGMLAN(answers.seed, answers.algo, answers.table, false);
  } else if (answerType.mode.startsWith("SA015")) {
    const answers = await inquirer.prompt([
      { name: "seed", message: "Seed (10 hex digits):", default: "8CE7D1FD06" },
      { name: "algo", message: "Algo ID (hex):", default: "87" },
    ]);
    runSA015(answers.seed, answers.algo, false);
  } else {
    const answers = await inquirer.prompt([
      { name: "seed", message: "Seed (4 hex digits):", default: "D435" },
      { name: "key", message: "Key (4 hex digits):", default: "3257" },
      {
        type: "list",
        name: "table",
        message: "Table:",
        choices: ["gmlan", "others", "class2"],
      },
    ]);
    runFind(answers.seed, answers.key, answers.table, false);
  }
}

function runGMLAN(
  seedStr: string,
  algoStr: string,
  tableName: string,
  json: boolean
) {
  try {
    const seedBytes = Utils.normalizeSeed(seedStr, 2);
    const seedInt = Utils.bytesToInt(seedBytes);
    const algo = parseInt(algoStr, 16);
    if (isNaN(algo)) throw new Error("Invalid Algo ID");

    let table = table_gmlan;
    if (tableName === "others") table = table_others;
    if (tableName === "class2") table = table_class2;

    const key = GMLANEngine.getKey(seedInt, algo, table);
    const keyHex = key.toString(16).toUpperCase().padStart(4, "0");

    if (json) {
      console.log(
        JSON.stringify({
          seed: seedStr,
          algo: algoStr,
          table: tableName,
          key: keyHex,
        })
      );
    } else {
      console.log(`Using Table: ${tableName}`);
      console.log(`Key: ${keyHex}`);
    }
  } catch (e: any) {
    if (json) console.log(JSON.stringify({ error: e.message }));
    else console.error("Error:", e.message);
    process.exit(1);
  }
}

async function runSA015(seedStr: string, algoStr: string, json: boolean) {
  try {
    const seedBytes = Utils.normalizeSeed(seedStr, 5);
    const algo = parseInt(algoStr, 16);
    if (isNaN(algo)) throw new Error("Invalid Algo ID");

    const result = await SA015Engine.deriveKey(algo, seedBytes);
    const k = Buffer.from(result.mac).toString("hex").toUpperCase();

    if (json) {
      console.log(
        JSON.stringify({
          seed: seedStr,
          algo: algoStr,
          iterations: result.iterations,
          key: k,
        })
      );
    } else {
      console.log(`Iterations: ${result.iterations}`);
      console.log(`Key: ${k}`);
    }
  } catch (e: any) {
    if (json) console.log(JSON.stringify({ error: e.message }));
    else console.error("Error:", e.message);
    process.exit(1);
  }
}

function runFind(
  seedStr: string,
  keyStr: string,
  tableName: string,
  json: boolean
) {
  try {
    const seedInt = Utils.bytesToInt(Utils.normalizeSeed(seedStr, 2));
    const keyInt = Utils.bytesToInt(Utils.normalizeSeed(keyStr, 2));

    let table = table_gmlan;
    if (tableName === "others") table = table_others;
    if (tableName === "class2") table = table_class2;

    if (!json) console.log(`Searching...`);
    const res = GMLANEngine.reverseEngineer(seedInt, keyInt, table);

    if (res.algo) {
      const algoHex = res.algo.toString(16).toUpperCase();
      if (json) {
        console.log(
          JSON.stringify({
            seed: seedStr,
            key: keyStr,
            found: true,
            algo: algoHex,
            algoId: res.algo,
          })
        );
      } else {
        console.log(`✅ FOUND! Algo ID: ${res.algo} (0x${algoHex})`);
      }
    } else {
      if (json)
        console.log(
          JSON.stringify({ seed: seedStr, key: keyStr, found: false })
        );
      else {
        console.log("❌ No match found.");
        process.exit(1);
      }
    }
  } catch (e: any) {
    if (json) console.log(JSON.stringify({ error: e.message }));
    else console.error("Error:", e.message);
    process.exit(1);
  }
}

program
  .command("gmlan")
  .description("Legacy 16-bit GMLAN/Class2 Key Calculation")
  .requiredOption("-s, --seed <hex>", "Seed (4 hex digits)")
  .requiredOption("-a, --algo <id>", "Algorithm ID")
  .option("-t, --table <name>", "Lookup table (gmlan, others, class2)", "gmlan")
  .action((options) =>
    runGMLAN(options.seed, options.algo, options.table, program.opts().json)
  );

program
  .command("sa015")
  .description("Modern 5-byte SA015 Key Calculation")
  .requiredOption("-s, --seed <hex>", "Seed (10 hex digits)")
  .requiredOption("-a, --algo <id>", "Algorithm ID")
  .action((options) =>
    runSA015(options.seed, options.algo, program.opts().json)
  );

program
  .command("find-algo")
  .description("Find Algo ID from Seed/Key (GMLAN)")
  .requiredOption("-s, --seed <hex>", "Seed")
  .requiredOption("-k, --key <hex>", "Key")
  .option("-t, --table <name>", "Lookup table", "gmlan")
  .action((options) =>
    runFind(options.seed, options.key, options.table, program.opts().json)
  );

program
  .command("parse-log")
  .description("Extract Seed/Key from Log File")
  .argument("<file>", "Path to log file")
  .action((file) => runParseLog(file, program.opts().json));

import { readFileSync } from "fs";

function runParseLog(filePath: string, json: boolean) {
  try {
    const content = readFileSync(filePath, "utf-8");
    const results = LogParser.parse(content);

    if (json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      if (results.length === 0) {
        console.log("No seeds found in log.");
        return;
      }
      console.log(`Found ${results.length} events:`);
      results.forEach((r: { seed: number; key: number }, i: number) => {
        console.log(`\n--- Event ${i + 1} ---`);
        console.log(
          `Seed: ${r.seed.toString(16).toUpperCase().padStart(4, "0")}`
        );
        console.log(
          `Key:  ${r.key.toString(16).toUpperCase().padStart(4, "0")}`
        );
      });
    }
  } catch (e: any) {
    if (json) console.log(JSON.stringify({ error: e.message }));
    else console.error("Error reading log:", e.message);
    process.exit(1);
  }
}

// Check if run without args (interactive mode)
if (process.argv.length <= 2) {
  runInteractive();
} else {
  program.parse();
}
