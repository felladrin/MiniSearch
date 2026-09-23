import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(__dirname, "changelog-guard.cjs");
const REPO_ROOT = path.resolve(__dirname, "..");
const { evaluate, MAX_LISTED_FILES } = createRequire(import.meta.url)(
  SCRIPT_PATH,
);

function runGuard(args = [], { stdin, env } = {}) {
  try {
    const output = execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
      input: stdin ?? "",
      env: { ...process.env, ...env },
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

// A shell pipeline, so the writer owns its end of the pipe. execFileSync's
// `input` hands the script a file descriptor instead, which never reproduces
// a writer that is slow or that marks the pipe non-blocking.
function runPipeline(writerCommand) {
  try {
    const output = execFileSync(
      "bash",
      ["-c", `${writerCommand} | "$0" "$1"`, process.execPath, SCRIPT_PATH],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: "pipe" },
    );
    return { exitCode: 0, stdout: output };
  } catch (error) {
    if (error.signal) throw new Error(`Killed by ${error.signal}`);
    return { exitCode: error.status ?? 1, stdout: error.stdout ?? "" };
  }
}

describe("changelog-guard decision", () => {
  it("fails a user-facing change that carries no changelog entry", () => {
    const { ok, reason } = evaluate({
      changedFiles: ["client/modules/search.ts"],
    });
    expect(ok).toBe(false);
    expect(reason).toContain("client/modules/search.ts");
    expect(reason).toContain("changelog.md");
  });

  it("passes the same change once changelog.md is part of it", () => {
    const { ok } = evaluate({
      changedFiles: ["client/modules/search.ts", "changelog.md"],
    });
    expect(ok).toBe(true);
  });

  it("passes a docs-only change", () => {
    const { ok } = evaluate({
      changedFiles: ["docs/pull-requests.md", "README.md", "agents.md"],
    });
    expect(ok).toBe(true);
  });

  it("passes a lockfile-only change", () => {
    const { ok } = evaluate({
      changedFiles: ["package-lock.json", "package.json"],
    });
    expect(ok).toBe(true);
  });

  it("passes a user-facing change carrying the skip-changelog label", () => {
    const { ok, reason } = evaluate({
      changedFiles: ["server/webSearchService.ts"],
      hasSkipLabel: true,
    });
    expect(ok).toBe(true);
    expect(reason).toContain("skip-changelog");
  });

  it("passes a Renovate pull request that only bumps the Dockerfile", () => {
    const { ok } = evaluate({
      changedFiles: ["Dockerfile"],
      authorLogin: "renovate[bot]",
    });
    expect(ok).toBe(true);
  });

  it("passes a Dependabot pull request that only bumps the Dockerfile", () => {
    const { ok } = evaluate({
      changedFiles: ["Dockerfile"],
      authorLogin: "dependabot[bot]",
    });
    expect(ok).toBe(true);
  });

  it("fails a human pull request that changes the Dockerfile with no entry", () => {
    const { ok, reason } = evaluate({
      changedFiles: ["Dockerfile"],
      authorLogin: "felladrin",
    });
    expect(ok).toBe(false);
    expect(reason).toContain("Dockerfile");
  });

  it.each([
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.production.yml",
    "searxng-settings.yml",
    "client/index.tsx",
    "server/searchToken.ts",
    "shared/types.ts",
  ])("treats %s as user-facing", (filePath) => {
    expect(evaluate({ changedFiles: [filePath] }).ok).toBe(false);
  });

  it.each([
    "docs/api.md",
    "changelog.md",
    "e2e/smoke.spec.ts",
    "scripts/changelog-guard.cjs",
    ".github/workflows/ci.yml",
    "clientele/notes.txt",
  ])("treats %s as not user-facing", (filePath) => {
    expect(evaluate({ changedFiles: [filePath] }).ok).toBe(true);
  });

  it("names today's UTC date in the heading it asks for", () => {
    const { reason } = evaluate({
      changedFiles: ["client/index.tsx"],
      // 00:30 UTC on the 24th; a local-time formatter would print the 23rd.
      now: new Date("2026-09-24T00:30:00Z"),
    });
    expect(reason).toContain("## 2026-09-24");
  });

  it("caps the listed files and counts the rest", () => {
    const changedFiles = Array.from(
      { length: MAX_LISTED_FILES + 3 },
      (_, index) => `client/modules/file${index}.ts`,
    );
    const { ok, reason } = evaluate({ changedFiles });
    expect(ok).toBe(false);
    expect(reason).toContain("and 3 more");
    expect(reason).not.toContain(`file${MAX_LISTED_FILES}.ts,`);
  });

  it("ignores blank lines from an empty git diff", () => {
    expect(evaluate({ changedFiles: ["", "  ", "\n"] }).ok).toBe(true);
  });

  it("requires an entry even when a non-trigger file is also changed", () => {
    const { ok } = evaluate({
      changedFiles: ["docs/api.md", "server/rerankerService.ts"],
    });
    expect(ok).toBe(false);
  });
});

describe("changelog-guard command line", () => {
  it("exits 1 and prints the remedy for a failing change", () => {
    const { exitCode, stdout } = runGuard(["client/modules/search.ts"]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("client/modules/search.ts");
    expect(stdout).toContain("skip-changelog");
  });

  it("exits 0 for a change that includes the changelog", () => {
    const { exitCode } = runGuard(["client/modules/search.ts", "changelog.md"]);
    expect(exitCode).toBe(0);
  });

  it("reads the changed files from stdin, one per line", () => {
    const { exitCode, stdout } = runGuard([], {
      stdin: "server/searchToken.ts\ndocs/api.md\n",
    });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("server/searchToken.ts");
  });

  it("honours --skip-label", () => {
    expect(runGuard(["Dockerfile", "--skip-label"]).exitCode).toBe(0);
  });

  it("honours --author for a bot", () => {
    expect(runGuard(["Dockerfile", "--author", "renovate[bot]"]).exitCode).toBe(
      0,
    );
  });

  it("reads the same facts from the environment", () => {
    expect(
      runGuard(["Dockerfile"], {
        env: { CHANGELOG_GUARD_SKIP_LABEL: "true" },
      }).exitCode,
    ).toBe(0);
    expect(
      runGuard(["Dockerfile"], {
        env: { CHANGELOG_GUARD_AUTHOR: "renovate[bot]" },
      }).exitCode,
    ).toBe(0);
    expect(
      runGuard(["Dockerfile"], {
        env: { CHANGELOG_GUARD_SKIP_LABEL: "false" },
      }).exitCode,
    ).toBe(1);
  });

  it("exits 1 on an unknown option", () => {
    const { exitCode, stderr } = runGuard(["--nope"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option");
  });

  it("exits 0 when nothing changed", () => {
    expect(runGuard([], { stdin: "" }).exitCode).toBe(0);
  });

  it("waits for a writer that has not produced anything yet", () => {
    const { exitCode, stdout } = runPipeline(
      `sleep 0.3; printf 'server/searchToken.ts\\n'`,
    );
    expect(exitCode).toBe(1);
    expect(stdout).toContain("server/searchToken.ts");
  });

  it("reads a list larger than one read buffer", () => {
    const paths = Array.from(
      { length: 4000 },
      (_, index) => `docs/file${index}.md`,
    );
    paths.push("client/index.tsx");
    const input = `${paths.join("\n")}\n`;
    expect(input.length).toBeGreaterThan(64 * 1024);

    const { exitCode, stdout } = runGuard([], { stdin: input });
    expect(exitCode).toBe(1);
    expect(stdout).toContain("client/index.tsx");
  });
});
