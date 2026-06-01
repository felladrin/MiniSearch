# Development Commands

## Build & Development

- **`docker compose up`**: Start development server with HMR on port 7861
- **`docker compose up --build`**: Compile for production
- **`docker compose exec development-server npm run start`**: Preview production build
- **`docker compose exec development-server npm run lint`**: Check code quality (Biome, TypeScript, knip, jscpd, architectural linter, documentation validator)
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

## CI/CD Pipeline

The repository uses six GitHub Actions workflows for continuous integration, deployment, and release management:

### Workflow Files

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push/PR to `main` or `master` | Full lint (`npm run lint`), format check (`npm run format`), and Vitest test suite |
| `on-push-to-main.yml` | Push to `main` | Delegates to `reusable-check-docker.yml` |
| `on-pull-request-to-main.yml` | PR opened/synced/reopened to `main` | Delegates to `reusable-check-docker.yml`; skippable via `skip-check-docker` label |
| `publish-docker-image.yml` | Manual (`workflow_dispatch`) | Builds multi-platform Docker image (linux/amd64, linux/arm64) and pushes to `ghcr.io` |
| `deploy-to-hugging-face.yml` | Manual (`workflow_dispatch`) | Syncs repository to Hugging Face Spaces using `JacobLinCool/huggingface-sync` |
| `reusable-check-docker.yml` | Called by other workflows | Docker compose production build + health check via `curl localhost:7860` (lint/format/test are covered by `ci.yml`) |

### Reusable Workflow (`reusable-check-docker.yml`)

Used by both `on-push-to-main` and `on-pull-request-to-main` to run the production container smoke test:

1. **check-docker-container** - Builds and starts the production container with `docker compose -f docker-compose.production.yml up -d`, then verifies the main page returns HTTP 200 within 60 seconds

### Docker Image Builds

The Docker image uses a multi-stage build:
1. **Builder stage** (`llama-builder`): Compiles llama-server from llama.cpp source, extracts shared libraries (`libllama.so`, `libmtmd.so`, `libggml.so`, etc.)
2. **Runtime stage**: Installs Python/SearXNG, copies llama-server binaries, builds the Vite frontend, runs SearXNG and Node.js in a single container via shell process composition

The production image is published to `ghcr.io` with multi-platform support (linux/amd64, linux/arm64). Tags and labels are auto-generated from Git metadata via `docker/metadata-action`.

### Manual Deployments

- **Publish Docker Image**: Triggered via GitHub UI — builds and pushes to GitHub Container Registry
- **Deploy to Hugging Face**: Triggered via GitHub UI — syncs the repository to a Hugging Face Space using configuration from `.github/hf-space-config.yml`

## Quality Assurance

- **`docker compose exec development-server npm run lint`**: Biome linting, TypeScript checking, dependency validation, copy-paste detection, architectural validation, and documentation checks
- **`docker compose exec development-server npm run format`**: Format code with Biome (enforced via pre-commit hooks)

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - Environment variables
- **Pull Requests**: `docs/pull-requests.md` - Contribution workflow
