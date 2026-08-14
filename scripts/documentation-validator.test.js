import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "documentation-validator.cjs");
const REPO_ROOT = path.resolve(__dirname, "..");
const { documentationFiles } = createRequire(import.meta.url)(SCRIPT_PATH);

function runValidator(rootDir, cwd = REPO_ROOT) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT_PATH, rootDir], {
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

function writeDoc(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

describe("documentation-validator", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-validator-test-"));
    for (const docFile of documentationFiles) {
      writeDoc(tmpDir, docFile, "# Doc\n");
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists no file this repository is missing", () => {
    expect(runValidator(REPO_ROOT).stdout).not.toContain("File not found");
  });

  it("fails and counts the issue when a listed file is missing", () => {
    const missing = ".github/ISSUE_TEMPLATE/bug_report.yml";
    fs.rmSync(path.join(tmpDir, missing));

    const { exitCode, stdout } = runValidator(tmpDir);

    expect(exitCode).toBe(1);
    expect(stdout).toContain(`File not found: ${missing}`);
    expect(stdout).toMatch(/Issues found: 1$/m);
  });

  it("fails and counts the issue when a listed file cannot be read", () => {
    const unreadable = path.join(tmpDir, ".github/SECURITY.md");
    fs.rmSync(unreadable);
    fs.mkdirSync(unreadable);

    const { exitCode, stdout } = runValidator(tmpDir);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("Error reading .github/SECURITY.md");
    expect(stdout).toMatch(/Issues found: 1$/m);
  });

  it("counts a broken link the same way it reports it", () => {
    writeDoc(tmpDir, "README.md", "# Doc\n\n[Gone](./nonexistent.md)\n");

    const { exitCode, stdout } = runValidator(tmpDir);

    expect(exitCode).toBe(1);
    expect(stdout).toContain('Missing target: "./nonexistent.md"');
    expect(stdout).toMatch(/Issues found: 1$/m);
  });

  it("rejects a root directory that does not exist", () => {
    const { exitCode, stderr } = runValidator(path.join(tmpDir, "missing"));

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Directory not found");
  });

  it("rejects a file given where a root directory belongs", () => {
    const { exitCode, stderr } = runValidator(path.join(tmpDir, "README.md"));

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Directory not found");
  });

  it("falls back to the repository root when the argument is empty", () => {
    const elsewhere = fs.mkdtempSync(
      path.join(os.tmpdir(), "doc-validator-cwd-"),
    );

    try {
      expect(runValidator("", elsewhere).stdout).not.toContain(
        "File not found",
      );
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });
});
