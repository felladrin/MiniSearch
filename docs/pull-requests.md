# Pull Request Guidelines

## PR Requirements

- Ensure `npm run lint` passes
- Keep PRs focused on a single feature or fix
- Include clear descriptions and screenshots for UI changes
- Write descriptive commit messages

## Review Process

- Automated checks run on all PRs (lint, tests, build)
- Human review optional but encouraged for complex changes
- Agent-to-agent review is primary mechanism
- Short-lived PRs preferred
- Test flakes addressed with follow-up runs rather than blocking

## Merge Philosophy

In high-throughput agent environments:
- Minimize blocking merge gates
- Keep PRs short-lived
- Corrections are cheap, waiting is expensive
- Address test flakes with follow-up runs rather than blocking progress indefinitely

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
