# Development Commands

## Build & Development

- **`docker compose up`**: Start development server with HMR on port 7861
- **`docker compose up --build`**: Compile for production
- **`docker compose exec development-server npm run start`**: Preview production build
- **`docker compose exec development-server npm run lint`**: Check code quality (Biome, TypeScript, dependencies)
- **`docker compose exec development-server npm run format`**: Auto-format code with Biome

## Docker

- **`docker compose up`**: Development environment with SearXNG, llama-server, and Node.js
- **`docker compose -f docker-compose.production.yml up --build`**: Production deployment

## Testing

- **`docker compose exec development-server npm run test`**: Run Vitest tests
- **`docker compose exec development-server npm run test:ui`**: Run tests with UI
- **`docker compose exec development-server npm run test:coverage`**: Run tests with coverage report

### Coverage Reports for AI Analysis

After running `test:coverage`, AI agents can analyze these JSON files:

- **`coverage/coverage-summary.json`**: Quick metrics view - overall percentages per file
  ```json
  {
    "total": {
      "lines": { "total": 100, "covered": 85, "pct": 85 },
      "statements": { "total": 120, "covered": 100, "pct": 83.33 },
      "functions": { "total": 30, "covered": 25, "pct": 83.33 },
      "branches": { "total": 50, "covered": 40, "pct": 80 }
    },
    "/path/to/file.ts": { ... }
  }
  ```

- **`coverage/coverage-final.json`**: Detailed per-file coverage with line-by-line mapping
  - Use this to identify specific uncovered lines, branches, and functions
  - Maps statement/branch/function IDs to source locations

AI agents can parse these to identify:
- Files with coverage below thresholds
- Uncovered lines and branches
- Functions without tests
- Coverage gaps across the codebase

## Quality Assurance

- **`docker compose exec development-server npm run lint`**: Biome linting, TypeScript checking, and dependency validation
- **`docker compose exec development-server npm run format`**: Format code with Biome (enforced via pre-commit hooks)

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - Environment variables
- **Pull Requests**: `docs/pull-requests.md` - Contribution workflow
