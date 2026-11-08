#!/usr/bin/env node
// Benchmarks wllama models in a real browser, through MiniSearch's own
// catalog, loading code and prompt builder. Manual tool, not part of
// `npm run lint`:
//
//   npm run bench:wllama -- --model qwen-3.5-0.8b
//   npm run bench:wllama -- --model owner/repo/file-00001-of-00003.gguf --device webgpu
//
// See docs/development-commands.md#wllama-benchmark for the options.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { scoreResults } from "./score.mjs";

const benchDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchDir, "../..");

const { values } = parseArgs({
  options: {
    model: { type: "string", multiple: true },
    device: { type: "string", default: "both" },
    runs: { type: "string", default: "1" },
    threads: { type: "string" },
    "template-kwargs": { type: "string" },
    "reasoning-budget": { type: "string" },
    chrome: { type: "string" },
    json: { type: "string" },
    "case-timeout": { type: "string", default: "300" },
    "system-prompt": { type: "string" },
    cases: { type: "string", default: path.join(benchDir, "cases.json") },
    profile: {
      type: "string",
      default: path.join(tmpdir(), "minisearch-wllama-bench-profile"),
    },
    verbose: { type: "boolean", default: false },
  },
});

if (!values.model?.length) {
  throw new Error(
    "Pass at least one --model <catalog id | owner/repo/file.gguf>",
  );
}
if (!["webgpu", "cpu", "both"].includes(values.device)) {
  throw new Error(
    `--device must be webgpu, cpu or both, not "${values.device}"`,
  );
}

const devices = values.device === "both" ? ["webgpu", "cpu"] : [values.device];
const runs = Number(values.runs);
const cases = JSON.parse(readFileSync(values.cases, "utf8"));

const server = await createServer({
  configFile: false,
  root: repoRoot,
  logLevel: "error",
  server: {
    host: "127.0.0.1",
    // SharedArrayBuffer, which wllama's threads need, requires an
    // isolated page; the app gets the same headers from crossOriginServerHook.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  resolve: {
    alias: { "@shared": path.join(repoRoot, "shared") },
  },
  optimizeDeps: { entries: ["scripts/wllama-bench/index.html"] },
});
await server.listen();
const pageUrl = new URL(
  "scripts/wllama-bench/index.html",
  server.resolvedUrls.local[0],
).href;

// A persistent profile keeps wllama's OPFS model cache between runs, so a
// model downloads once rather than on every invocation. Two runs at once
// need two profiles, since Chromium locks the one in use.
const browser = await chromium.launchPersistentContext(values.profile, {
  headless: true,
  executablePath: values.chrome,
  args: ["--enable-unsafe-webgpu"],
});

const results = [];
let failures = 0;

for (const model of values.model) {
  for (const device of devices) {
    for (let run = 1; run <= runs; run++) {
      const page = await browser.newPage();
      const consoleLines = [];
      page.on("console", (message) => {
        consoleLines.push(message.text());
        if (values.verbose) console.error(`[page] ${message.text()}`);
      });
      page.on("pageerror", (error) => consoleLines.push(error.message));

      try {
        await page.goto(pageUrl);
        await page.waitForFunction(() => window.benchReady);
        const result = await page.evaluate(
          (options) => window.runBench(options),
          {
            model,
            device,
            cases,
            threads: values.threads ? Number(values.threads) : undefined,
            chatTemplateKwargs: values["template-kwargs"]
              ? JSON.parse(values["template-kwargs"])
              : undefined,
            caseTimeoutSeconds: Number(values["case-timeout"]),
            systemPrompt: values["system-prompt"]
              ? readFileSync(values["system-prompt"], "utf8")
              : undefined,
            reasoningBudgetTokens: values["reasoning-budget"]
              ? Number(values["reasoning-budget"])
              : undefined,
          },
        );
        results.push({ ...result, run });
        printResult(result, run);
      } catch (error) {
        failures++;
        console.error(
          `\n✗ ${model} on ${device}, run ${run}: ${error.message}`,
        );
        console.error(consoleLines.slice(-30).join("\n"));
      } finally {
        await page.close();
      }
    }
  }
}

await browser.close();
await server.close();

if (values.json) writeFileSync(values.json, JSON.stringify(results, null, 2));
if (cases.some((c) => c.facts) && results.length) {
  console.log("\nScore (see docs/wllama-model-evaluation.md):");
  for (const { model, score, maximum } of scoreResults(cases, results)) {
    console.log(`  ${score.toFixed(1)}/${maximum}  ${model}`);
  }
}
process.exitCode = failures ? 1 : 0;

function printResult(result, run) {
  const round = (value, digits = 1) =>
    value === undefined ? "-" : Number(value.toFixed(digits));
  console.log(
    `\n${result.model} on ${result.device}, run ${run} (load ${round(result.loadSeconds)} s)`,
  );
  console.table(
    Object.fromEntries(
      result.cases.map((c) => [
        c.name,
        {
          "prompt tok": c.promptTokens,
          "prompt tok/s": round(c.promptTokensPerSecond),
          "gen tok/s": round(c.generatedTokensPerSecond),
          "thinking tok": c.thinkingTokens,
          "answer tok": c.answerTokens,
          "first answer s": round(c.secondsToFirstAnswerToken),
          "total s": round(c.totalSeconds),
        },
      ]),
    ),
  );
  for (const c of result.cases) {
    console.log(`  ${c.name}: ${JSON.stringify(c.answer.slice(0, 400))}`);
  }
}
