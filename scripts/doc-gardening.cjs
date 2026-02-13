const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

class DocGardener {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.issues = [];
  }

  async garden() {
    console.log("🌱 Starting doc gardening...");

    await this.checkDocFreshness();
    await this.checkCrossReferences();
    await this.checkCodeDocAlignment();

    await this.reportIssues();
    await this.createFixupPRs();
  }

  async checkDocFreshness() {
    console.log("📅 Checking documentation freshness...");

    const docsDir = path.join(this.rootDir, "docs");
    if (!fs.existsSync(docsDir)) return;

    const docFiles = this.getAllMarkdownFiles(docsDir);

    for (const docFile of docFiles) {
      const stats = fs.statSync(docFile);
      const daysSinceModified =
        (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceModified > 30) {
        this.issues.push({
          type: "stale_doc",
          file: docFile,
          severity: "warning",
          message: `Document hasn't been updated in ${Math.floor(daysSinceModified)} days`,
          remediation:
            "Review and update content to reflect current codebase state",
        });
      }
    }
  }

  async checkCrossReferences() {
    console.log("🔗 Checking cross-references...");

    const docsDir = path.join(this.rootDir, "docs");
    const docFiles = this.getAllMarkdownFiles(docsDir);

    for (const docFile of docFiles) {
      const content = fs.readFileSync(docFile, "utf8");
      const links = content.match(/\[.*?\]\((.*?)\)/g) || [];

      for (const link of links) {
        const match = link.match(/\[.*?\]\((.*?)\)/);
        if (!match) continue;

        const target = match[1];

        if (
          target.startsWith("./") ||
          target.startsWith("../") ||
          target.startsWith("docs/")
        ) {
          const targetPath = path.resolve(path.dirname(docFile), target);

          if (!fs.existsSync(targetPath)) {
            this.issues.push({
              type: "broken_link",
              file: docFile,
              severity: "error",
              message: `Broken link to ${target}`,
              remediation: `Update link to point to existing documentation or create missing file: ${targetPath}`,
            });
          }
        }
      }
    }
  }

  async checkCodeDocAlignment() {
    console.log("🔄 Checking code-documentation alignment...");

    const componentsDir = path.join(this.rootDir, "client/components");
    const docsDir = path.join(this.rootDir, "docs");

    if (fs.existsSync(componentsDir) && fs.existsSync(docsDir)) {
      const components = this.getDirectories(componentsDir);
      const projectStructureDoc = path.join(docsDir, "project-structure.md");

      if (fs.existsSync(projectStructureDoc)) {
        const content = fs.readFileSync(projectStructureDoc, "utf8");

        for (const component of components) {
          if (!content.includes(component)) {
            this.issues.push({
              type: "missing_doc",
              file: projectStructureDoc,
              severity: "warning",
              message: `Component ${component} not documented in project structure`,
              remediation: `Add documentation for ${component} component to project-structure.md`,
            });
          }
        }
      }
    }
  }

  async reportIssues() {
    if (this.issues.length === 0) {
      console.log("✅ No documentation issues found!");
      return;
    }

    console.log(`\n🌿 Found ${this.issues.length} documentation issues:\n`);

    for (const issue of this.issues) {
      console.log(
        `${issue.severity === "error" ? "🚫" : "⚠️"}  ${issue.message}`,
      );
      console.log(`   📁 File: ${issue.file}`);
      console.log(`   💡 ${issue.remediation}\n`);
    }

    const errorCount = this.issues.filter((i) => i.severity === "error").length;
    const warningCount = this.issues.filter(
      (i) => i.severity === "warning",
    ).length;

    console.log(`Summary: ${errorCount} errors, ${warningCount} warnings`);
  }

  async createFixupPRs() {
    const errorIssues = this.issues.filter((i) => i.severity === "error");

    if (errorIssues.length === 0) {
      console.log("✅ No fix-up PRs needed!");
      return;
    }

    console.log(`🔧 Creating fix-up PR for ${errorIssues.length} issues...`);

    const branchName = `doc-gardening-${Date.now()}`;
    try {
      execSync(`git checkout -b ${branchName}`, { cwd: this.rootDir });

      for (const issue of errorIssues) {
        await this.applyFix(issue);
      }

      execSync("git add .", { cwd: this.rootDir });
      execSync(
        `git commit -m "docs: fix documentation issues found by doc gardening"`,
        { cwd: this.rootDir },
      );

      console.log(`✅ Created fix-up PR branch: ${branchName}`);
      console.log("📝 Run the following to create the PR:");
      console.log(`   git push -u origin ${branchName}`);
      console.log(
        '   gh pr create --title "docs: fix documentation issues" --body "Automated documentation fixes from doc gardening process"',
      );
    } catch (error) {
      console.error("❌ Failed to create fix-up PR:", error.message);
    }
  }

  async applyFix(issue) {
    switch (issue.type) {
      case "broken_link": {
        const content = fs.readFileSync(issue.file, "utf8");
        const fixedContent = content.replace(/\[.*?\]\([^)]*?\)/g, (match) => {
          const target = match.match(/\((.*?)\)/)[1];
          if (
            target.startsWith("./") ||
            target.startsWith("../") ||
            target.startsWith("docs/")
          ) {
            const targetPath = path.resolve(path.dirname(issue.file), target);
            if (!fs.existsSync(targetPath)) {
              return match.replace(
                /\[.*?\]\([^)]*?\)/,
                "[REMOVED BROKEN LINK]",
              );
            }
          }
          return match;
        });
        fs.writeFileSync(issue.file, fixedContent);
        break;
      }

      default:
        console.log(`⚠️  No automatic fix available for ${issue.type}`);
    }
  }

  getAllMarkdownFiles(dir) {
    const files = [];

    if (!fs.existsSync(dir)) return files;

    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.getAllMarkdownFiles(fullPath));
      } else if (item.endsWith(".md")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  getDirectories(dir) {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir).filter((item) => {
      const fullPath = path.join(dir, item);
      return fs.statSync(fullPath).isDirectory();
    });
  }
}

if (require.main === module) {
  const rootDir = process.argv[2] || process.cwd();
  const gardener = new DocGardener(rootDir);

  gardener.garden().catch((error) => {
    console.error("Doc gardening error:", error);
    process.exit(1);
  });
}

module.exports = DocGardener;
