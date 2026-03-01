#!/usr/bin/env node

/**
 * Documentation Link Validator
 *
 * This script validates that all linked files in documentation exist.
 * It checks markdown files for internal links and verifies the targets exist.
 */

const fs = require("fs");
const path = require("path");

// Configuration
const docsDir = path.join(__dirname, "..");
const documentationFiles = [
  "README.md",
  ".github/CONTRIBUTING.md",
  ".github/CODE_OF_CONDUCT.md",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
  ".github/ISSUE_TEMPLATE/security_vulnerability.md",
];

// Regex patterns for finding internal links
const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
const htmlLinkRegex = /<a[^>]+href="([^"]+)"[^>]*>/g;

function validateFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(docsDir, filePath);
    const issues = [];

    // Find all markdown links
    let match;
    while (true) {
      match = markdownLinkRegex.exec(content);
      if (match === null) break;
      const linkText = match[1];
      const linkTarget = match[2];

      // Skip external links, anchors, and email links
      if (
        linkTarget.startsWith("http") ||
        linkTarget.startsWith("mailto:") ||
        linkTarget.startsWith("#") ||
        linkTarget.startsWith("www.")
      ) {
        continue;
      }

      // Resolve the target path
      const targetPath = path.resolve(path.dirname(filePath), linkTarget);

      // Check if target exists
      if (!fs.existsSync(targetPath)) {
        issues.push({
          type: "missing-file",
          linkText,
          linkTarget,
          targetPath: path.relative(docsDir, targetPath),
        });
      }
    }

    // Find all HTML links
    while (true) {
      match = htmlLinkRegex.exec(content);
      if (match === null) break;
      const linkTarget = match[1];

      // Skip external links and anchors
      if (
        linkTarget.startsWith("http") ||
        linkTarget.startsWith("mailto:") ||
        linkTarget.startsWith("#")
      ) {
        continue;
      }

      // Resolve the target path
      const targetPath = path.resolve(path.dirname(filePath), linkTarget);

      // Check if target exists
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

function main() {
  console.log("🔍 Validating documentation links...\n");

  let totalIssues = 0;
  let totalFiles = 0;

  for (const docFile of documentationFiles) {
    const filePath = path.join(docsDir, docFile);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${docFile}`);
      continue;
    }

    totalFiles++;
    const result = validateFile(filePath);

    if (result.error) {
      console.log(`❌ Error reading ${result.file}: ${result.error}`);
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
  console.log(`   Files checked: ${totalFiles}`);
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
  main();
}

module.exports = { validateFile };
