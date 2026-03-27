# Pull Request Guidelines

## PR Requirements

- Ensure `npm run lint` passes (Biome, TypeScript, knip, jscpd, architectural linter, documentation validator)
- Keep PRs focused on a single feature or fix
- Include clear descriptions and screenshots for UI changes
- Write descriptive commit messages using conventional commits
- Run tests with `npm run test` and ensure coverage is maintained
- Update documentation when making API or feature changes

## Review Process

- Automated checks run on all PRs (Biome formatting/linting, TypeScript type checking, knip dead code detection, jscpd copy-paste detection, dpdm circular dependency detection, architectural linter, documentation validation)
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
- **dpdm**: Circular dependency detection
- **Custom architectural linter**: Project-specific rules
- **Documentation validator**: Ensures docs stay current

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
