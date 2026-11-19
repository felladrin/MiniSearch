#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const defaultDocsDir = path.join(__dirname, "..");
// The .yml issue forms are listed so a renamed or deleted template is caught;
// they only link out today, so the link check finds nothing in them.
const documentationFiles = [
  "README.md",
  ".github/CONTRIBUTING.md",
  ".github/CODE_OF_CONDUCT.md",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/security_vulnerability.yml",
];

const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
const htmlLinkRegex = /<a[^>]+href="([^"]+)"[^>]*>/g;

function validateFile(filePath, docsDir = defaultDocsDir) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(docsDir, filePath);
    const issues = [];

    let match;
    while (true) {
      match = markdownLinkRegex.exec(content);
      if (match === null) break;
      const linkText = match[1];
      const linkTarget = match[2];

      if (
        linkTarget.startsWith("http") ||
        linkTarget.startsWith("mailto:") ||
        linkTarget.startsWith("#") ||
        linkTarget.startsWith("www.")
      ) {
        continue;
      }

      const targetPath = path.resolve(path.dirname(filePath), linkTarget);

      if (!fs.existsSync(targetPath)) {
        issues.push({
          type: "missing-file",
          linkText,
          linkTarget,
          targetPath: path.relative(docsDir, targetPath),
        });
      }
    }

    while (true) {
      match = htmlLinkRegex.exec(content);
      if (match === null) break;
      const linkTarget = match[1];

      if (
        linkTarget.startsWith("http") ||
        linkTarget.startsWith("mailto:") ||
        linkTarget.startsWith("#")
      ) {
        continue;
      }

      const targetPath = path.resolve(path.dirname(filePath), linkTarget);

      if (!fs.existsSync(targetPath)) {
        issues.push({
          type: "missing-file",
          linkText: "HTML link",
          linkTarget,
          targetPath: path.relative(docsDir, targetPath),
        });
      }
    }

    return { file: relativePath, issues };
  } catch (error) {
    return {
      file: path.relative(docsDir, filePath),
      error: error.message,
    };
  }
}

function main(docsDir = defaultDocsDir) {
  console.log("🔍 Validating documentation links...\n");

  let totalIssues = 0;
  let totalFiles = 0;

  for (const docFile of documentationFiles) {
    const filePath = path.join(docsDir, docFile);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${docFile}`);
      totalIssues++;
      continue;
    }

    totalFiles++;
    const result = validateFile(filePath, docsDir);

    if (result.error) {
      console.log(`❌ Error reading ${result.file}: ${result.error}`);
      totalIssues++;
      continue;
    }

    if (result.issues.length > 0) {
      console.log(`❌ ${result.file} has ${result.issues.length} issue(s):`);
      result.issues.forEach((issue) => {
        console.log(
          `   • Missing target: "${issue.linkTarget}" (${issue.linkText})`,
        );
        console.log(`     Expected: ${issue.targetPath}`);
      });
      totalIssues += result.issues.length;
    } else {
      console.log(`✅ ${result.file} - All links valid`);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Files checked: ${totalFiles}/${documentationFiles.length}`);
  console.log(`   Issues found: ${totalIssues}`);

  if (totalIssues > 0) {
    console.log(
      `\n❌ Documentation validation failed with ${totalIssues} issue(s)`,
    );
    process.exit(1);
  } else {
    console.log(`\n✅ All documentation links are valid!`);
    process.exit(0);
  }
}

if (require.main === module) {
  const rootDirArg = process.argv[2];

  if (
    rootDirArg &&
    !fs.statSync(rootDirArg, { throwIfNoEntry: false })?.isDirectory()
  ) {
    console.error(`❌ Directory not found: ${rootDirArg}`);
    process.exit(1);
  }

  main(rootDirArg || undefined);
}

module.exports = { validateFile, documentationFiles };
