import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "doc-gardening.cjs");

function runGarden(cwd, args = []) {
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

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    // Keep the developer's own git config and repo out of the fixture: a global
    // commit.gpgsign or core.hooksPath would fail the commit below, and an
    // inherited GIT_DIR would point these commands at the wrong repository.
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_INDEX_FILE: undefined,
    },
  });
}

function writeMd(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function makeStale(docPath) {
  const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  fs.utimesSync(docPath, oldTime, oldTime);
}

describe("doc-gardening", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "doc-garden-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never reaches for git", () => {
    expect(fs.readFileSync(SCRIPT_PATH, "utf8")).not.toMatch(
      /require\((["'])(node:)?child_process\1\)/,
    );
  });

  it("exits 0 when there are no errors", () => {
    writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](./api.md)\n");
    writeMd(tmpDir, "docs/api.md", "# API\n");
    expect(runGarden(tmpDir).exitCode).toBe(0);
  });

  it("exits 1 naming the file and the target of a broken relative link", () => {
    writeMd(
      tmpDir,
      "docs/overview.md",
      "# Overview\n\n[Link](./nonexistent.md)\n",
    );
    const { exitCode, stdout } = runGarden(tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("docs/overview.md");
    expect(stdout).toContain("./nonexistent.md");
  });

  it("leaves the branch and the working tree untouched when it finds errors", () => {
    git(tmpDir, "init");
    git(tmpDir, "config", "user.email", "test@example.com");
    git(tmpDir, "config", "user.name", "Test");
    writeMd(
      tmpDir,
      "docs/overview.md",
      "# Overview\n\n[Link](./nonexistent.md)\n",
    );
    git(tmpDir, "add", "docs/overview.md");
    git(tmpDir, "commit", "-m", "init");
    fs.writeFileSync(path.join(tmpDir, "unrelated.txt"), "work in progress\n");

    const branchBefore = git(tmpDir, "rev-parse", "--abbrev-ref", "HEAD");
    const branchesBefore = git(tmpDir, "branch", "--list");
    const statusBefore = git(tmpDir, "status", "--porcelain");

    const { exitCode, stdout } = runGarden(tmpDir);

    expect(exitCode).toBe(1);
    expect(stdout).toContain("./nonexistent.md");
    expect(git(tmpDir, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branchBefore);
    expect(git(tmpDir, "branch", "--list")).toBe(branchesBefore);
    expect(git(tmpDir, "status", "--porcelain")).toBe(statusBefore);
  });

  it("reports stale docs as warnings without failing", () => {
    makeStale(writeMd(tmpDir, "docs/old.md", "# Old\n"));
    const { exitCode, stdout } = runGarden(tmpDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hasn't been updated in");
  });

  it("still exits 1 when a warning accompanies an error", () => {
    makeStale(writeMd(tmpDir, "docs/old.md", "# Old\n\n[Link](./gone.md)\n"));
    const { exitCode, stdout } = runGarden(tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Summary: 1 errors, 1 warnings");
  });

  it("ignores the anchor and the title of an otherwise valid link", () => {
    writeMd(
      tmpDir,
      "docs/overview.md",
      '# Overview\n\n[Section](./api.md#foo)\n[Titled](./api.md "The API")\n',
    );
    writeMd(tmpDir, "docs/api.md", "# API\n");
    expect(runGarden(tmpDir).exitCode).toBe(0);
  });

  it("resolves a docs/-prefixed link the way a renderer does, against the linking file", () => {
    writeMd(tmpDir, "docs/overview.md", "# Overview\n\n[Link](docs/api.md)\n");
    writeMd(tmpDir, "docs/api.md", "# API\n");
    const { exitCode, stdout } = runGarden(tmpDir);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(path.join("docs", "docs", "api.md"));
  });

  it("accepts a root directory outside the current one", () => {
    writeMd(
      tmpDir,
      "docs/overview.md",
      "# Overview\n\n[Link](./nonexistent.md)\n",
    );
    const { exitCode, stdout } = runGarden(__dirname, [tmpDir]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain(path.join("docs", "overview.md"));
    expect(stdout).not.toContain(os.tmpdir());
  });

  it("rejects an unknown option instead of treating it as the root directory", () => {
    const { exitCode, stderr } = runGarden(tmpDir, ["--fix"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option");
  });

  it("rejects a root directory that does not exist", () => {
    const { exitCode, stderr } = runGarden(tmpDir, [
      path.join(tmpDir, "missing"),
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Directory not found");
  });

  it("rejects extra arguments", () => {
    const { exitCode, stderr } = runGarden(tmpDir, [tmpDir, "--fix"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Too many arguments");
  });
});
