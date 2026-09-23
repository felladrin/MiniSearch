# Pull Request Guidelines

## PR Requirements

- Ensure `npm run lint` passes (Biome, TypeScript, knip, jscpd, architectural linter, documentation validator)
- Keep PRs focused on a single feature or fix
- Include clear descriptions and screenshots for UI changes
- Write descriptive commit messages using conventional commits
- Run tests with `npm run test` and ensure coverage is maintained
- Update documentation when making API or feature changes

## Review Process

- Automated checks run on all PRs (Biome formatting/linting, TypeScript type checking, knip dead code detection, jscpd copy-paste detection, architectural linter, documentation validation, npm audit for dependency vulnerabilities, Gitleaks secret scanning)
- Human review optional but encouraged for complex changes
- Agent-to-agent review is primary mechanism
- Short-lived PRs preferred
- Test flakes addressed with follow-up runs rather than blocking
- Coverage reports available for AI analysis in `coverage/` directory

## Quality Gates

Before any change, run this command in the development container:
```bash
docker compose exec development-server npm run lint
```

This comprehensive check includes:
- **Biome**: Code formatting and linting
- **TypeScript**: Type checking with strict mode
- **knip**: Dead code detection
- **jscpd**: Copy-paste detection
- **Custom architectural linter**: Project-specific rules
- **Documentation validator**: Ensures docs stay current
- **npm audit**: Dependency vulnerability scanning (fails on high/critical)
- **Gitleaks**: Secret scanning across full git history (CI only)

## Changelog Entries

The GitHub Release body is built from `changelog.md`, not from GitHub's generated notes: the publish workflow takes every changelog line that was not there at the previous release tag, under its `## YYYY-MM-DD` heading. A change with no entry therefore ships with no mention in the Release.

The `changelog-guard` job on every PR to `main` fails when the PR changes a user-facing path and does not touch `changelog.md`. The trigger paths are:

- anything under `client/`, `server/`, or `shared/`
- `Dockerfile`, `docker-compose.yml`, `docker-compose.production.yml`, `searxng-settings.yml`

Add your entry to `changelog.md` under a `## YYYY-MM-DD` heading for today's date in UTC, most recent date first.

Two ways out:

- Add the `skip-changelog` label when the change touches a trigger path but is not notable for users - an internal refactor, a rename, a CI-only edit inside a trigger path.
- Renovate and Dependabot PRs pass automatically. Renovate bumps the pinned SearXNG commit in the `Dockerfile` and cannot write an entry.

Run the same check locally with `npm run changelog-guard`, passing the changed paths:

```bash
git diff --name-only origin/main...HEAD | npm run changelog-guard
```

## Merge Philosophy

In high-throughput agent environments:
- Minimize blocking merge gates
- Keep PRs short-lived
- Corrections are cheap, waiting is expensive
- Address test flakes with follow-up runs rather than blocking progress indefinitely
- Automated quality gates ensure consistency without manual bottlenecks

## Commit Message Format

Use conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation changes
- `refactor:` for code refactoring
- `test:` for test changes
- `chore:` for maintenance tasks

## Related Topics

- **Development Commands**: `docs/development-commands.md` - Available npm commands
- **Coding Conventions**: `docs/coding-conventions.md` - Code style guidelines
- **Quick Start**: `docs/quick-start.md` - Setting up the project
