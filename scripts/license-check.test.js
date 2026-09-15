import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "license-check.cjs");
const REPO_ROOT = path.resolve(__dirname, "..");

function runCheck(cwd, args = []) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (error) {
    if (error.signal) throw new Error(`Killed by ${error.signal}`);
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function writeLockfile(dir, packages) {
  const lockPath = path.join(dir, "package-lock.json");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      name: "fixture",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "fixture", version: "0.0.0", dependencies: {} },
        ...packages,
      },
    }),
    "utf8",
  );
  return lockPath;
}

describe("license-check", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "license-check-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 when every production package has an allowed license", () => {
    writeLockfile(tmpDir, {
      "node_modules/one": { version: "1.0.0", license: "MIT" },
      "node_modules/two": { version: "2.0.0", license: "Apache-2.0" },
    });
    const { exitCode, stdout } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("compatible with Apache-2.0");
  });

  it("exits 1 naming the package and license when a production package is GPL-3.0", () => {
    writeLockfile(tmpDir, {
      "node_modules/gpl-pkg": { version: "1.0.0", license: "GPL-3.0" },
    });
    const { exitCode, stdout } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("gpl-pkg");
    expect(stdout).toContain("GPL-3.0");
  });

  it("allows an OR expression where one side is allowed", () => {
    writeLockfile(tmpDir, {
      "node_modules/or-pkg": {
        version: "1.0.0",
        license: "MIT OR GPL-3.0",
      },
    });
    const { exitCode } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("fails an AND expression where one side is not allowed", () => {
    writeLockfile(tmpDir, {
      "node_modules/and-pkg": {
        version: "1.0.0",
        license: "MIT AND GPL-3.0",
      },
    });
    const { exitCode, stdout } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("and-pkg");
  });

  it("ignores dev dependencies", () => {
    writeLockfile(tmpDir, {
      "node_modules/dev-gpl": {
        version: "1.0.0",
        license: "GPL-3.0",
        dev: true,
      },
    });
    const { exitCode } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("allows an opaque license field for a package that is in OVERRIDE", () => {
    writeLockfile(tmpDir, {
      "node_modules/flatbuffers": {
        version: "1.0.0",
        license: "SEE LICENSE IN LICENSE.txt",
      },
    });
    const { exitCode } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(0);
  });

  it("fails an opaque license field for a package that is not in OVERRIDE", () => {
    writeLockfile(tmpDir, {
      "node_modules/mystery-pkg": {
        version: "1.0.0",
        license: "SEE LICENSE IN LICENSE.txt",
      },
    });
    const { exitCode, stdout } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("mystery-pkg");
  });

  it("fails a production package with no license field and no OVERRIDE entry", () => {
    writeLockfile(tmpDir, {
      "node_modules/no-license": { version: "1.0.0" },
    });
    const { exitCode, stdout } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("no-license");
  });

  it("passes the real repository lockfile", () => {
    const { exitCode } = runCheck(REPO_ROOT, []);
    expect(exitCode).toBe(0);
  });

  it("writes a LICENSES.md report with every production package when --report is given", () => {
    writeLockfile(tmpDir, {
      "node_modules/alpha": { version: "1.0.0", license: "MIT" },
      "node_modules/beta": { version: "2.0.0", license: "ISC" },
      "node_modules/dev-only": {
        version: "3.0.0",
        license: "GPL-3.0",
        dev: true,
      },
    });
    const reportPath = path.join(tmpDir, "LICENSES.md");
    const { exitCode } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
      "--report",
      reportPath,
    ]);
    expect(exitCode).toBe(0);
    const report = fs.readFileSync(reportPath, "utf8");
    expect(report).toContain("| Package | License |");
    expect(report).toContain("| alpha | MIT |");
    expect(report).toContain("| beta | ISC |");
    expect(report).not.toContain("dev-only");
  });

  it("does not change the exit code when a failing check writes a report", () => {
    writeLockfile(tmpDir, {
      "node_modules/gpl-pkg": { version: "1.0.0", license: "GPL-3.0" },
    });
    const reportPath = path.join(tmpDir, "LICENSES.md");
    const { exitCode } = runCheck(tmpDir, [
      path.join(tmpDir, "package-lock.json"),
      "--report",
      reportPath,
    ]);
    expect(exitCode).toBe(1);
    expect(fs.existsSync(reportPath)).toBe(true);
  });

  it("does not write any file when --report is absent", () => {
    writeLockfile(tmpDir, {
      "node_modules/one": { version: "1.0.0", license: "MIT" },
    });
    const lockPath = path.join(tmpDir, "package-lock.json");
    const reportPath = path.join(tmpDir, "LICENSES.md");
    expect(runCheck(tmpDir, [lockPath]).exitCode).toBe(0);
    expect(fs.existsSync(reportPath)).toBe(false);
  });
});
