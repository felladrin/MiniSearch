#!/usr/bin/env node

/**
 * Native/WASM module supply-chain gate.
 *
 * Verifies the trust invariants documented in .github/SECURITY.md for the
 * project's native and WebAssembly dependencies:
 *
 *  1. Every tracked module is pinned to an exact version in package.json
 *     (no caret/tilde range a later publish could slide into).
 *  2. package-lock.json resolves it to that exact version with an
 *     integrity hash.
 *  3. Every package in the lockfile that ships an install script has an
 *     explicit entry in package.json#allowScripts — no unreviewed script,
 *     whether allowed or denied.
 *  4. `npm audit signatures` reports no invalid or missing registry
 *     signature for a tracked module.
 *
 * Fails loudly (non-zero exit, one line per problem) on a missing or
 * mismatched entry.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Direct dependencies whose payload is native code or WebAssembly rather
 * than auditable JavaScript. Kept in sync with the inventory table in
 * .github/SECURITY.md.
 */
const NATIVE_MODULES = [
  "@huggingface/tokenizers",
  "@moonshine-ai/moonshine-wasm",
  "@wllama/wllama",
  "hash-wasm",
  "onnxruntime-node",
];

// A single exact version, optionally with a prerelease tag. Anything with a
// range operator is rejected: native/WASM deps must be reviewed per version.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// The two key shapes `npm approve-scripts` / `npm deny-scripts` write:
// a bare name (covers every version) or an exact `name@version` pin.
function policyCovers(allowScripts, name, version) {
  return (
    Object.hasOwn(allowScripts, name) ||
    Object.hasOwn(allowScripts, `${name}@${version}`)
  );
}

function checkPins(pkg, problems) {
  for (const name of NATIVE_MODULES) {
    const spec = pkg.dependencies?.[name];
    if (spec === undefined) {
      problems.push(`${name}: not a direct dependency of this project`);
    } else if (!EXACT_VERSION.test(spec)) {
      problems.push(
        `${name}: "${spec}" is not an exact pin; native/WASM deps must declare a single version`,
      );
    }
  }
}

function checkLock(lock, pkg, problems) {
  for (const name of NATIVE_MODULES) {
    const spec = pkg.dependencies?.[name];
    if (typeof spec !== "string" || !EXACT_VERSION.test(spec)) {
      continue; // already reported by checkPins
    }
    const entry = lock.packages?.[`node_modules/${name}`];
    if (!entry) {
      problems.push(`${name}@${spec}: missing from package-lock.json`);
      continue;
    }
    if (entry.version !== spec) {
      problems.push(
        `${name}: package.json pins ${spec} but the lockfile resolves ${entry.version}`,
      );
    }
    if (!entry.integrity) {
      problems.push(
        `${name}@${entry.version}: lockfile entry has no integrity hash`,
      );
    }
  }
}

function checkInstallScriptPolicy(lock, allowScripts, problems) {
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "" || !entry.hasInstallScript) continue;
    const name = key.split("node_modules/").pop();
    if (!policyCovers(allowScripts, name, entry.version)) {
      problems.push(
        `${name}@${entry.version}: ships an install script with no entry in package.json#allowScripts ` +
          `(review it, then \`npm approve-scripts ${name}\` or \`npm deny-scripts ${name}\`)`,
      );
    }
  }
}

function checkRegistrySignatures(rootDir, problems) {
  const res = spawnSync("npm", ["audit", "signatures", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    problems.push(
      `npm audit signatures could not be run: ${res.error.message}`,
    );
    return;
  }
  let report;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    problems.push(
      `npm audit signatures produced no parseable report (exit ${res.status}); ` +
        "the registry may be unreachable — treat as unverified",
    );
    return;
  }
  for (const [kind, items] of [
    ["invalid", report.invalid ?? []],
    ["missing", report.missing ?? []],
  ]) {
    for (const item of items) {
      if (NATIVE_MODULES.includes(item.name)) {
        problems.push(
          `${item.name}@${item.version}: ${kind} registry signature`,
        );
      } else {
        console.log(
          `note: ${item.name}@${item.version} has a ${kind} registry signature ` +
            "(outside this gate's native/WASM scope; see `npm audit signatures`)",
        );
      }
    }
  }
}

/**
 * Runs every check against a project root and returns the process exit code.
 *
 * @param {string} rootDir Project root containing package.json,
 *   package-lock.json and an installed node_modules tree.
 * @returns {number} 0 when all invariants hold, 1 otherwise.
 */
function run(rootDir) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
  );
  const lock = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package-lock.json"), "utf8"),
  );
  const problems = [];

  checkPins(pkg, problems);
  checkLock(lock, pkg, problems);
  checkInstallScriptPolicy(lock, pkg.allowScripts ?? {}, problems);
  if (fs.existsSync(path.join(rootDir, "node_modules"))) {
    checkRegistrySignatures(rootDir, problems);
  } else {
    problems.push(
      "node_modules is missing; run `npm ci` before the integrity check",
    );
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.log(`❌ ${problem}`);
    }
    console.log(
      `\n${problems.length} native-module integrity problem(s) found (of ${NATIVE_MODULES.length} tracked modules)`,
    );
    return 1;
  }

  console.log(
    `✅ All ${NATIVE_MODULES.length} tracked native/WASM modules are exactly pinned, locked with integrity hashes, covered by the install-script policy, and free of invalid or missing registry signatures`,
  );
  return 0;
}

if (require.main === module) {
  const rootDirArg = process.argv[2];
  const usage = "Usage: node scripts/native-module-integrity.cjs [rootDir]";

  if (rootDirArg?.startsWith("-")) {
    console.error(`❌ Unknown option: ${rootDirArg}\n   ${usage}`);
    process.exit(1);
  }

  if (rootDirArg && !fs.existsSync(rootDirArg)) {
    console.error(`❌ Directory not found: ${rootDirArg}`);
    process.exit(1);
  }

  process.exit(run(rootDirArg || path.resolve(__dirname, "..")));
}

module.exports = { run, NATIVE_MODULES };
