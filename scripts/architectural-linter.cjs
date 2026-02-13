const fs = require("node:fs");
const path = require("node:path");

const EXTERNAL_API_ALLOWLIST = [
  {
    pattern: /buildHordeUrl\(/,
    description: "AI Horde is browser-safe and must be called directly",
  },
];

const VIOLATIONS = {
  COMPONENT_NOT_SELF_CONTAINED: {
    message: "Component should be self-contained in its own folder",
    remediation:
      "Move component to its own folder with related styles, hooks, and utilities. See docs/project-structure.md for guidelines.",
    severity: "error",
  },

  CONTEXT_PROVIDER_NESTING: {
    message: "Avoid nested Context providers - use create-pubsub instead",
    remediation:
      "Replace Context providers with create-pubsub stores. See docs/coding-conventions.md for state management patterns.",
    severity: "error",
  },

  RELATIVE_IMPORT_DEEP: {
    message: "Deep relative imports detected - use absolute paths",
    remediation:
      "Configure absolute path aliases and use them instead of relative imports. See tsconfig.json for alias configuration.",
    severity: "warning",
  },

  ANY_TYPE_USAGE: {
    message: 'Usage of "any" type detected',
    remediation:
      'Replace "any" with proper TypeScript types. Use interfaces for data structures. See docs/coding-conventions.md for TypeScript guidelines.',
    severity: "error",
  },

  MISSING_REACT_MEMO: {
    message: "Large component without React.memo optimization",
    remediation:
      "Wrap expensive components in React.memo() and use useCallback() for props. See docs/coding-conventions.md for performance guidelines.",
    severity: "warning",
  },

  EXTERNAL_API_DIRECT: {
    message: "Direct external API calls detected - route through server hooks",
    remediation:
      "Move API calls to server hooks for validation and caching. See docs/architecture.md for search pipeline patterns.",
    severity: "error",
  },

  MISSING_TSDOC: {
    message: "Public API missing TSDoc documentation",
    remediation:
      "Add TSDoc comments for public APIs. Use /** */ format. See docs/coding-conventions.md for documentation guidelines.",
    severity: "warning",
  },
};

class ArchitecturalLinter {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.violations = [];
  }

  async lint() {
    console.log("🔍 Running architectural linter...");

    await this.scanDirectory(path.join(this.rootDir, "client"));
    await this.scanDirectory(path.join(this.rootDir, "server"));

    this.reportViolations();
    return this.violations.length === 0;
  }

  async scanDirectory(dir) {
    if (!fs.existsSync(dir)) return;

    const items = fs.readdirSync(dir);

    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        await this.scanDirectory(fullPath);
      } else if (item.endsWith(".ts") || item.endsWith(".tsx")) {
        await this.lintFile(fullPath);
      }
    }
  }

  async lintFile(filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const relativePath = path.relative(this.rootDir, filePath);

    this.checkViolations(content, relativePath);
  }

  checkViolations(content, filePath) {
    if (content.includes(": any") || content.includes(" = any")) {
      this.addViolation("ANY_TYPE_USAGE", filePath);
    }

    if (content.includes("Context.Provider")) {
      this.addViolation("CONTEXT_PROVIDER_NESTING", filePath);
    }

    const deepImports = content.match(/from ['"]\.\.\/\.\.\//g);
    if (deepImports && deepImports.length > 0) {
      this.addViolation("RELATIVE_IMPORT_DEEP", filePath);
    }

    // Check for direct external API calls (excluding internal API endpoints)
    if (content.includes("fetch(") && !filePath.includes("server/")) {
      // Look for URL patterns in fetch calls
      const fetchPatterns = [
        // fetch with string URLs
        /fetch\(\s*['"`]([^'"`]+)['"`]/g,
        /fetch\([^)]+\)/g,
      ];

      let hasExternalApi = false;

      for (const pattern of fetchPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          hasExternalApi = matches.some((match) => {
            const isInternal =
              match.includes("/api/") ||
              match.includes("/search/") ||
              match.includes("/inference") ||
              match.includes("self.location.origin") ||
              match.includes("window.location.origin") ||
              match.includes(".json") ||
              (content.includes("self.location.origin") &&
                match.includes("toString()")) ||
              (content.includes("window.location.origin") &&
                match.includes("toString()"));
            const isAllowlisted = EXTERNAL_API_ALLOWLIST.some(({ pattern }) =>
              pattern.test(match),
            );
            return !isInternal && !isAllowlisted;
          });
        }
        if (hasExternalApi) break;
      }

      if (hasExternalApi) {
        this.addViolation("EXTERNAL_API_DIRECT", filePath);
      }
    }

    const lines = content.split("\n");
    if (
      lines.length > 100 &&
      content.includes("export function") &&
      !content.includes("React.memo") &&
      (content.includes("useEffect") ||
        content.includes("useState") ||
        content.includes("useCallback") ||
        content.includes("useMemo") ||
        content.includes("return <") ||
        filePath.endsWith(".tsx")) &&
      !filePath.includes("/hooks/") &&
      !content.includes("export function use") &&
      !content.includes("export const use")
    ) {
      this.addViolation("MISSING_REACT_MEMO", filePath);
    }

    const exports = content.match(/export (function|interface|type|const)/g);
    if (exports && exports.length > 0 && !content.includes("/**")) {
      this.addViolation("MISSING_TSDOC", filePath);
    }
  }

  addViolation(type, filePath) {
    const violation = VIOLATIONS[type];
    if (!violation) return;

    this.violations.push({
      type,
      file: filePath,
      ...violation,
    });
  }

  reportViolations() {
    if (this.violations.length === 0) {
      console.log("✅ No architectural violations found!");
      return;
    }

    console.log(
      `\n❌ Found ${this.violations.length} architectural violations:\n`,
    );

    const groupedViolations = this.violations.reduce((groups, violation) => {
      if (!groups[violation.type]) {
        groups[violation.type] = [];
      }
      groups[violation.type].push(violation);
      return groups;
    }, {});

    for (const [type, violations] of Object.entries(groupedViolations)) {
      const violation = violations[0];
      console.log(
        `${violation.severity === "error" ? "🚫" : "⚠️"}  ${type}: ${violation.message}`,
      );
      console.log(`   💡 ${violation.remediation}`);
      console.log(
        `   📁 Found in: ${violations.map((v) => v.file).join(", ")}\n`,
      );
    }

    const errorCount = this.violations.filter(
      (v) => v.severity === "error",
    ).length;
    const warningCount = this.violations.filter(
      (v) => v.severity === "warning",
    ).length;

    console.log(`Summary: ${errorCount} errors, ${warningCount} warnings`);
  }
}

if (require.main === module) {
  const rootDir = process.argv[2] || process.cwd();
  const linter = new ArchitecturalLinter(rootDir);

  linter
    .lint()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Linter error:", error);
      process.exit(1);
    });
}
