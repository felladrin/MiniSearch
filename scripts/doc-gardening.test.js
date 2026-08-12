import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "doc-gardening.cjs");

function runGarden(args = [], cwd = __dirname) {
  const cmd = `node ${SCRIPT_PATH} ${args.join(" ")}`;
  try {
    const output = execSync(cmd, { cwd, encoding: "utf8", stdio: "pipe" });
    return { exitCode: 0, stdout: output, stderr: "" };
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-garden-test-"));
}

function writeMd(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

describe("doc-gardening", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("without --fix", () => {
    it("exits 0 when there are no errors", () => {
      writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](./api.md)\n");
      writeMd(tmpDir, "docs/api.md", "# API\n");
      const { exitCode } = runGarden([], tmpDir);
      expect(exitCode).toBe(0);
    });

    it("exits 1 when there is a broken relative link", () => {
      writeMd(
        tmpDir,
        "docs/overview.md",
        "# Overview\n\n[Link](./nonexistent.md)\n",
      );
      const { exitCode, stdout } = runGarden([], tmpDir);
      expect(exitCode).toBe(1);
      expect(stdout).toContain("docs/overview.md");
      expect(stdout).toContain("./nonexistent.md");
    });

    it("does not run any git commands", () => {
      writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](./api.md)\n");
      writeMd(tmpDir, "docs/api.md", "# API\n");
      const { stdout } = runGarden([], tmpDir);
      expect(stdout).not.toContain("git checkout");
      expect(stdout).not.toContain("git add");
      expect(stdout).not.toContain("git commit");
    });

    it("reports stale docs as warnings without failing", () => {
      const docPath = writeMd(tmpDir, "docs/old.md", "# Old\n");
      const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      fs.utimesSync(docPath, oldTime, oldTime);
      const { exitCode, stdout } = runGarden([], tmpDir);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("hasn't been updated in");
    });

    it("does not fail on anchor-only links", () => {
      writeMd(
        tmpDir,
        "docs/overview.md",
        "# Overview\n\n[Section](./api.md#foo)\n",
      );
      writeMd(tmpDir, "docs/api.md", "# API\n");
      const { exitCode } = runGarden([], tmpDir);
      expect(exitCode).toBe(0);
    });

    it("does not fail on docs/-prefixed links that exist", () => {
      writeMd(
        tmpDir,
        "docs/overview.md",
        "# Overview\n\n[Link](docs/api.md)\n",
      );
      writeMd(tmpDir, "docs/api.md", "# API\n");
      const { exitCode } = runGarden([], tmpDir);
      expect(exitCode).toBe(0);
    });
  });

  describe("with --fix", () => {
    it("requires a clean working tree", () => {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", {
        cwd: tmpDir,
        stdio: "pipe",
      });
      execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
      writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](./api.md)\n");
      writeMd(tmpDir, "docs/api.md", "# API\n");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit -m init", { cwd: tmpDir, stdio: "pipe" });
      fs.writeFileSync(path.join(tmpDir, "README.md"), "uncommitted\n");
      const { exitCode, stderr } = runGarden(["--fix"], tmpDir);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("working tree is not clean");
    });

    it("exits 0 when there are no errors even with --fix", () => {
      execSync("git init", { cwd: tmpDir, stdio: "pipe" });
      execSync("git config user.email 'test@test.com'", {
        cwd: tmpDir,
        stdio: "pipe",
      });
      execSync("git config user.name 'Test'", { cwd: tmpDir, stdio: "pipe" });
      writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](./api.md)\n");
      writeMd(tmpDir, "docs/api.md", "# API\n");
      execSync("git add .", { cwd: tmpDir, stdio: "pipe" });
      execSync("git commit -m init", { cwd: tmpDir, stdio: "pipe" });
      const { exitCode } = runGarden(["--fix"], tmpDir);
      expect(exitCode).toBe(0);
    });
  });
});
