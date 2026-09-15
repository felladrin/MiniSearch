const fs = require("node:fs");
const path = require("node:path");

const ALLOWED = new Set([
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unlicense",
  "CC0-1.0",
  "0BSD",
  "LGPL-2.1",
  "LGPL-3.0",
]);

// Each entry below was verified by hand against the LICENSE file shipped in
// that package's own node_modules directory. A new opaque-license package
// must be added here ONLY after a human has read its license file.
const OVERRIDE = {
  flatbuffers: "Apache-2.0",
  "keyword-extractor": "MIT",
};

const OPAQUE = "SEE LICENSE IN LICENSE.txt";

// OR = any side may be allowed; AND = every side must be allowed.
function isAllowed(license) {
  if (typeof license !== "string") return false;
  if (ALLOWED.has(license)) return true;
  if (license.includes(" OR ")) {
    return license
      .split(" OR ")
      .some((side) => ALLOWED.has(side.replace(/^\(|\)$/g, "").trim()));
  }
  if (license.includes(" AND ")) {
    return license
      .split(" AND ")
      .every((side) => ALLOWED.has(side.replace(/^\(|\)$/g, "").trim()));
  }
  return false;
}

// A missing license field and the opaque "SEE LICENSE IN LICENSE.txt" field
// are only allowed via the OVERRIDE map, which a human must populate after
// reading the package's own license. Any other package with such a field
// fails the gate (safety net).
function isAllowedLicense(name, license) {
  if (license === undefined || license === OPAQUE) {
    return isAllowed(OVERRIDE[name]);
  }
  return isAllowed(license);
}

function productionPackages(lock) {
  const packages = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (key === "") continue;
    if (entry.dev) continue;
    if (entry.link) continue;
    const name = key.split("node_modules/").pop();
    packages.push({
      name,
      version: entry.version ?? "unknown",
      license: entry.license,
    });
  }
  return packages;
}

function formatLicense(license) {
  return typeof license === "string" ? license : "no license field";
}

function writeReport(reportPath, packages) {
  const rows = [...packages].sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    "# Dependency Licenses",
    "",
    `Project license: **Apache-2.0**`,
    "",
    "| Package | License |",
    "| --- | --- |",
    ...rows.map((p) => `| ${p.name} | ${formatLicense(p.license)} |`),
    "",
  ];
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
}

function run(lockPath, reportPath) {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const packages = productionPackages(lock);
  const violations = packages.filter(
    (p) => !isAllowedLicense(p.name, p.license),
  );

  if (violations.length > 0) {
    for (const v of violations) {
      console.log(
        `NOT ALLOWED: ${v.name}@${v.version} (${formatLicense(v.license)})`,
      );
    }
    console.log(
      `\n${violations.length} of ${packages.length} production packages have a license that is not compatible with Apache-2.0`,
    );
    if (reportPath) writeReport(reportPath, packages);
    return 1;
  }

  console.log(
    `All ${packages.length} production packages have a license compatible with Apache-2.0`,
  );
  if (reportPath) writeReport(reportPath, packages);
  return 0;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const usage =
    "Usage: node scripts/license-check.cjs [lockfilePath] [--report <path>]";

  let lockfilePath;
  let reportPath;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--report") {
      reportPath = args[++i];
      if (!reportPath) {
        console.error(`❌ --report requires a path\n   ${usage}`);
        process.exit(1);
      }
    } else if (args[i].startsWith("-")) {
      console.error(`❌ Unknown option: ${args[i]}\n   ${usage}`);
      process.exit(1);
    } else if (lockfilePath === undefined) {
      lockfilePath = args[i];
    } else {
      console.error(`❌ Too many arguments\n   ${usage}`);
      process.exit(1);
    }
  }

  const rootDir = path.resolve(__dirname, "..");
  lockfilePath = lockfilePath
    ? path.resolve(lockfilePath)
    : path.join(rootDir, "package-lock.json");

  if (!fs.existsSync(lockfilePath)) {
    console.error(`❌ Lockfile not found: ${lockfilePath}`);
    process.exit(1);
  }

  process.exit(run(lockfilePath, reportPath));
}

module.exports = { run, isAllowedLicense, ALLOWED, OVERRIDE };
