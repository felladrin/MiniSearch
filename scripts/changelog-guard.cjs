#!/usr/bin/env node

/**
 * Changelog Guard
 *
 * The GitHub Release body is built from changelog.md, not from
 * --generate-notes (see .github/workflows/publish-docker-image.yml). That
 * mechanism publishes whatever the changelog contains and never notices a
 * line that nobody wrote, so a user-facing change with no entry ships
 * unmentioned. This is the pull-request-time tripwire for that gap.
 */

const fs = require("node:fs");

const CHANGELOG_FILE = "changelog.md";
const SKIP_LABEL = "skip-changelog";

// A change under one of these directories, or to one of these files, is
// assumed to be user-facing until the author says otherwise with the label.
const TRIGGER_DIRECTORIES = ["client/", "server/", "shared/"];
const TRIGGER_FILES = new Set([
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.production.yml",
  "searxng-settings.yml",
]);

// Renovate bumps the pinned SearXNG commit in the Dockerfile and cannot write
// a changelog entry. Its merged pull requests here carry no labels at all, so
// the label hatch alone would not cover them.
const BOT_AUTHORS = new Set(["renovate[bot]", "dependabot[bot]"]);

// Keeps the failure message readable when a pull request touches a whole tree.
const MAX_LISTED_FILES = 10;

function isTriggerPath(filePath) {
  return (
    TRIGGER_FILES.has(filePath) ||
    TRIGGER_DIRECTORIES.some((directory) => filePath.startsWith(directory))
  );
}

function formatFileList(files) {
  const listed = files.slice(0, MAX_LISTED_FILES);
  const remaining = files.length - listed.length;
  return remaining > 0
    ? `${listed.join(", ")}, and ${remaining} more`
    : listed.join(", ");
}

function utcDateHeading(now) {
  return now.toISOString().slice(0, 10);
}

/**
 * The whole decision, as a pure function of its inputs, so it can be tested
 * without GitHub.
 */
function evaluate({
  changedFiles = [],
  hasSkipLabel = false,
  authorLogin = "",
  now = new Date(),
} = {}) {
  const files = changedFiles
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);
  const triggered = files.filter(isTriggerPath);

  if (triggered.length === 0) {
    return {
      ok: true,
      reason: "No user-facing file changed, so no changelog entry is needed.",
    };
  }

  if (files.includes(CHANGELOG_FILE)) {
    return { ok: true, reason: `${CHANGELOG_FILE} is part of this change.` };
  }

  if (hasSkipLabel) {
    return {
      ok: true,
      reason: `The "${SKIP_LABEL}" label marks this change as not notable for users.`,
    };
  }

  if (BOT_AUTHORS.has(authorLogin)) {
    return {
      ok: true,
      reason: `${authorLogin} opened this change and cannot write a changelog entry.`,
    };
  }

  return {
    ok: false,
    reason: [
      `${triggered.length} user-facing file(s) changed with no entry in ${CHANGELOG_FILE}: ${formatFileList(triggered)}.`,
      "",
      `The GitHub Release body is built from ${CHANGELOG_FILE}, so a change with no entry ships unmentioned.`,
      `Add a line to ${CHANGELOG_FILE} under a "## ${utcDateHeading(now)}" heading (today's date in UTC),`,
      `or add the "${SKIP_LABEL}" label when the change is not notable for users.`,
    ].join("\n"),
  };
}

function readChangedFilesFromStdin() {
  if (process.stdin.isTTY) return [];
  return fs.readFileSync(0, "utf8").split("\n");
}

function isTruthyFlag(value) {
  return value === "true" || value === "1" || value === "yes";
}

if (require.main === module) {
  const usage =
    "Usage: node scripts/changelog-guard.cjs [changedFile...] [--skip-label] [--author <login>]\n" +
    "       git diff --name-only origin/main...HEAD | node scripts/changelog-guard.cjs";

  const args = process.argv.slice(2);
  const changedFiles = [];
  let hasSkipLabel = isTruthyFlag(process.env.CHANGELOG_GUARD_SKIP_LABEL);
  let authorLogin = process.env.CHANGELOG_GUARD_AUTHOR ?? "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--skip-label") {
      hasSkipLabel = true;
    } else if (args[i] === "--author") {
      authorLogin = args[++i];
      if (authorLogin === undefined) {
        console.error(`❌ --author requires a login\n   ${usage}`);
        process.exit(1);
      }
    } else if (args[i].startsWith("--")) {
      console.error(`❌ Unknown option: ${args[i]}\n   ${usage}`);
      process.exit(1);
    } else {
      changedFiles.push(args[i]);
    }
  }

  if (changedFiles.length === 0) {
    changedFiles.push(...readChangedFilesFromStdin());
  }

  const { ok, reason } = evaluate({ changedFiles, hasSkipLabel, authorLogin });

  console.log(ok ? `✅ ${reason}` : `❌ ${reason}`);
  process.exit(ok ? 0 : 1);
}

module.exports = {
  evaluate,
  CHANGELOG_FILE,
  SKIP_LABEL,
  TRIGGER_DIRECTORIES,
  TRIGGER_FILES,
  BOT_AUTHORS,
  MAX_LISTED_FILES,
};
