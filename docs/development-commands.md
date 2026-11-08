# Development Commands

## Build & Development

- **`docker compose up`**: Start development server (main app on 7860, HMR on 7861)
- **`docker compose up --build`**: Compile for production
- **`docker compose exec development-server npm run start`**: Preview production build
- **`docker compose exec development-server npm run lint`**: Check code quality (Biome, TypeScript, knip, jscpd, architectural linter, documentation validator)
- **`docker compose exec development-server npm run format`**: Auto-format code with Biome

## Docker

- **`docker compose up`**: Development environment with SearXNG and Node.js
- **`docker compose -f docker-compose.production.yml up --build`**: Production deployment

## Testing

- **`docker compose exec development-server npm run test`**: Run Vitest tests
- **`docker compose exec development-server npm run test:watch`**: Run tests in watch mode
- **`docker compose exec development-server npm run test:coverage`**: Run tests with coverage report

Failure-injection cases (dependency down, empty results, aborted stream) are catalogued in `docs/failure-injection.md`.

## Offline eval

`eval/` is an offline eval that gives a regression signal for changes to the
reranker, the system prompt, the search-results formatting, or the model. See
`eval/README.md` for details and the LLM-judge environment variables.

- **`npm run eval`**: Run the full eval (retrieval + answer)
- **`npm run eval:retrieval`**: Retrieval eval (real ONNX reranker; local only, needs the model in `server/models/`)
- **`npm run eval:answer`**: Answer eval (LLM judge; gated on `EVAL_LLM_API_KEY`, skips without one)

## wllama benchmark

`npm run bench:wllama` loads a wllama model in headless Chromium, times it on the questions in `scripts/wllama-bench/cases.json`, and scores the answers. It goes through MiniSearch's own code: the catalog entry in `client/modules/wllama.ts`, the warmup-then-load in `initializeWllama`, and the chat messages built from search results and page excerpts. So the numbers and answers are the ones a user would get. Use it to vet a model before it joins the catalog, or to compare catalog models. The scoring rules and the latest results are in [wllama-model-evaluation.md](wllama-model-evaluation.md).

```bash
npm run bench:wllama -- --model qwen-3.5-0.8b --model granite-4.2-3b --device webgpu
npm run bench:wllama -- --model owner/repo/Model-Q4_K_M-00001-of-00003.gguf --template-kwargs '{"enable_thinking":false}'
```

| Option                 | Default              | Meaning                                                                                |
| ---------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `--model` (repeatable) | required             | A catalog id, or `owner/repo/file.gguf` on Hugging Face for a model not in the catalog |
| `--device`             | `both`               | `webgpu`, `cpu` (`n_gpu_layers: 0`, what MiniSearch does without WebGPU), or `both`    |
| `--runs`               | `1`                  | Repetitions per model and device                                                       |
| `--threads`            | `cpuThreads` setting | CPU threads                                                                            |
| `--template-kwargs`    | catalog value        | JSON for `chat_template_kwargs`; replaces the catalog's                                |
| `--reasoning-budget`   | catalog value        | `reasoning_budget_tokens`, applied at load time as the app does                        |
| `--chrome`             | Playwright Chromium  | Path to another Chromium binary                                                        |
| `--json`               | none                 | Writes every result, including the full reasoning and answer, to this file             |
| `--cases`              | `cases.json`         | Another question set with the same shape                                               |
| `--case-timeout`       | `300`                | Seconds before an answer is cut off; the scorer counts the cut as a violation          |
| `--profile`            | see below            | Browser profile directory; two runs at once need two, since Chromium locks one in use  |
| `--system-prompt`      | none                 | A file with another system prompt, to measure a change to it before shipping it        |
| `--verbose`            | off                  | Streams the page console, llama.cpp's log included                                     |

Things to know:

- Run it on the host, not in the dev container, which has no browser or GPU. It needs the host's `npm install` and Playwright's Chromium (`npx playwright install chromium`).
- An old system Chrome is not a stand-in: Chrome 137 rejects the `subgroup_id` WGSL builtin that wllama's WebGPU shaders use, so every model aborts on WebGPU there.
- The browser profile lives in `<system temp>/minisearch-wllama-bench-profile`, so OPFS keeps each model after its first download. Delete that folder to reclaim the space.
- On a failure the script prints the page's last console lines; llama.cpp's reason for an abort is usually among them.

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

The repository uses nine GitHub Actions workflows for continuous integration, deployment, release management, security scanning, and issue triage:

### Workflow Files

| Workflow                      | Trigger                                   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                      | Push/PR to `main` or `master`             | Full lint (`npm run lint`), format check (`npm run format`), and Vitest test suite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `security.yml`                | Push/PR to `main` or `master`             | Secret scanning (Gitleaks) and license compliance check (`npm run license-check`) with artifact upload                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `on-push-to-main.yml`         | Push to `main`                            | Delegates to `reusable-check-docker.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `on-pull-request-to-main.yml` | PR opened/synced/reopened to `main`       | Delegates to `reusable-check-docker.yml`; skippable via `skip-check-docker` label                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `publish-docker-image.yml`    | Manual (`workflow_dispatch`), `main` only | Cuts a CalVer release: validates the optional `version` input (empty auto-computes today's date in UTC plus the next free same-day sequence), builds the multi-platform Docker image (linux/amd64, linux/arm64) and pushes it to `ghcr.io` as that version plus `latest` (build job, `contents: read` + `packages: write`), then a second job holding `contents: write` pushes the git tag and publishes the GitHub Release. The release job is idempotent: when a run pushed the tag but failed before publishing the Release, re-running that job alone finishes it without rebuilding |
| `scan-docker-image.yml`       | Weekly (Monday 06:00 UTC) or manual       | Trivy scan of the published image, reporting fixable HIGH/CRITICAL findings to code scanning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `deploy-to-hugging-face.yml`  | Manual (`workflow_dispatch`)              | Syncs the repository to a Hugging Face Space with the `hf` CLI over OIDC Trusted Publishers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `stale.yml`                   | Daily (01:30 UTC) or manual               | Marks and closes inactive issues and labels stale pull requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `reusable-check-docker.yml`   | Called by other workflows                 | Docker compose production build + health check via `curl localhost:7860` (lint/format/test are covered by `ci.yml`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Reusable Workflow (`reusable-check-docker.yml`)

Used by both `on-push-to-main` and `on-pull-request-to-main` to run the production container smoke test:

1. **check-docker-container** - Builds and starts the production container with `docker compose -f docker-compose.production.yml up -d`, then verifies the main page returns HTTP 200 within 60 seconds

### Docker Image Builds

The Docker image uses a single runtime stage:
The image installs Python/SearXNG, builds the Vite frontend, and runs SearXNG and Node.js in a single container via shell process composition. No compilation step is required: the reranker's ONNX Runtime binaries ship prebuilt with the npm dependency.

The production image is published to `ghcr.io` with multi-platform support (linux/amd64, linux/arm64). Labels are auto-generated from Git metadata via `docker/metadata-action`, and each release is published as `latest` and as its CalVer version tag; to pin a build, users reference the version tag or the image digest. Weekly, `scan-docker-image.yml` runs Trivy against the published `latest` and reports fixable HIGH/CRITICAL findings to code scanning.

### Manual Deployments

- **Publish Docker Image**: Triggered via GitHub UI from `main`, with an optional CalVer `version` input (leave it empty to auto-compute today's date in UTC and the next free same-day sequence) — builds and pushes the image to GitHub Container Registry, then pushes the git tag and publishes the GitHub Release
- **Deploy to Hugging Face**: Triggered via GitHub UI — syncs the repository to a Hugging Face Space using configuration from `.github/hf-space-config.yml`

## Quality Assurance

- **`docker compose exec development-server npm run lint`**: Biome linting, TypeScript checking, dependency validation, copy-paste detection, architectural validation, and documentation checks
- **`docker compose exec development-server npm run format`**: Format code with Biome (enforced via pre-commit hooks)

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - Environment variables
- **Pull Requests**: `docs/pull-requests.md` - Contribution workflow
