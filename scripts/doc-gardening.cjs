const fs = require("node:fs");
const path = require("node:path");

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

    this.reportIssues();

    if (this.issues.some((issue) => issue.severity === "error")) {
      process.exitCode = 1;
    }
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

      for (const [, rawTarget] of content.matchAll(/\[.*?\]\((.*?)\)/g)) {
        // Drop the optional link title, then the anchor or query, the way a
        // markdown renderer does before resolving the path.
        const [pathPart] = rawTarget.trim().split(/\s+/);
        const [target] = pathPart.split(/[#?]/);

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
              message: `Broken link in ${path.relative(this.rootDir, docFile)} to ${rawTarget}`,
              remediation: `Update link to point to existing documentation or create missing file: ${path.relative(this.rootDir, targetPath)}`,
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

  reportIssues() {
    if (this.issues.length === 0) {
      console.log("✅ No documentation issues found!");
      return;
    }

    console.log(`\n🌿 Found ${this.issues.length} documentation issues:\n`);

    for (const issue of this.issues) {
      console.log(
        `${issue.severity === "error" ? "🚫" : "⚠️"}  ${issue.message}`,
      );
      console.log(`   📁 File: ${path.relative(this.rootDir, issue.file)}`);
      console.log(`   💡 ${issue.remediation}\n`);
    }

    const errorCount = this.issues.filter((i) => i.severity === "error").length;
    const warningCount = this.issues.filter(
      (i) => i.severity === "warning",
    ).length;

    console.log(`Summary: ${errorCount} errors, ${warningCount} warnings`);
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
  const args = process.argv.slice(2);
  const [rootDirArg] = args;
  const usage = "Usage: node scripts/doc-gardening.cjs [rootDir]";

  if (args.length > 1) {
    console.error(`❌ Too many arguments\n   ${usage}`);
    process.exit(1);
  }

  if (rootDirArg?.startsWith("-")) {
    console.error(`❌ Unknown option: ${rootDirArg}\n   ${usage}`);
    process.exit(1);
  }

  if (rootDirArg && !fs.existsSync(rootDirArg)) {
    console.error(`❌ Directory not found: ${rootDirArg}`);
    process.exit(1);
  }

  const gardener = new DocGardener(rootDirArg || process.cwd());

  gardener.garden().catch((error) => {
    console.error("Doc gardening error:", error);
    process.exitCode = 1;
  });
}

module.exports = DocGardener;
