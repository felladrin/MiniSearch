# Contributing to MiniSearch

First off, thank you for considering contributing to MiniSearch! It's people like you that make MiniSearch such a great tool.

## Quick Start

- **Onboarding**: See [`../docs/quick-start.md`](../docs/quick-start.md) for setup and running the app.
- **Development workflow**: See [`../docs/pull-requests.md`](../docs/pull-requests.md) for the full PR process.
- **Architecture guide**: See [`../agents.md`](../agents.md) for codebase navigation.
- **Full docs**: Browse [`../docs/`](../docs/) for architecture, configuration, and AI integration.

## Code Quality

Before submitting a pull request, please run:

```bash
docker compose exec development-server npm run lint
```

This runs:
- Biome (formatting/linting)
- TypeScript (type checking)
- knip (dead code detection)
- jscpd (copy-paste detection)
- Custom architectural linter
- `doc-gardening.cjs` (documentation checks)
- `documentation-validator.cjs` (documentation validation)

## Reporting Bugs

- Use the [GitHub issue tracker](https://github.com/felladrin/MiniSearch/issues) to report bugs.
- Check if the issue has already been reported before creating a new one.
- Provide clear steps to reproduce the issue.
- Include your environment details (OS, browser, Docker version if applicable).
- Add screenshots if the issue is UI-related.

## Suggesting Features

- Use the [GitHub issue tracker](https://github.com/felladrin/MiniSearch/issues) for feature suggestions.
- Clearly describe the feature and why it would be useful.
- Consider if it fits with the project's minimalist philosophy.
- Provide examples of how you envision the feature working.

## Questions?

Don't hesitate to ask questions! We're here to help you contribute successfully.

---

Thanks again for your interest in contributing to MiniSearch! 🎉
