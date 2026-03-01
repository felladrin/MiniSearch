# Contributing to MiniSearch

First off, thank you for considering contributing to MiniSearch! It's people like you that make MiniSearch such a great tool.

## How to Contribute

### Reporting Bugs

- Use the [GitHub issue tracker](https://github.com/felladrin/MiniSearch/issues) to report bugs
- Check if the issue has already been reported before creating a new one
- Provide clear steps to reproduce the issue
- Include your environment details (OS, browser, Docker version if applicable)
- Add screenshots if the issue is UI-related

### Suggesting Features

- Use the [GitHub issue tracker](https://github.com/felladrin/MiniSearch/issues) for feature suggestions
- Clearly describe the feature and why it would be useful
- Consider if it fits with the project's minimalist philosophy
- Provide examples of how you envision the feature working

### Development Setup

1. Fork the repository and clone it locally
2. Make sure you have [Docker](https://docs.docker.com/get-docker/) installed
3. Start the development server:
   ```bash
   docker compose up
   ```
4. The application will be available at http://localhost:7860
5. Make your changes
6. Test your changes thoroughly
7. Push to your fork and create a pull request

### Running Tests

```bash
docker compose exec development-server npm run test
```

For coverage:
```bash
docker compose exec development-server npm run test:coverage
```

### Code Quality

Before submitting a pull request, please run:
```bash
docker compose exec development-server npm run lint
```

This runs:
- Biome (formatting/linting)
- TypeScript (type checking)
- ts-prune (dead code detection)
- jscpd (copy-paste detection)
- dpdm (circular dependency detection)
- Custom architectural linter

## Contribution Guidelines

### Types of Contributions We're Looking For

- **Bug fixes**: Always welcome!
- **Documentation improvements**: Better docs help everyone
- **Performance optimizations**: Especially for search and AI features
- **UI/UX improvements**: Keeping the minimalist yet intuitive design
- **New AI model integrations**: Following existing patterns
- **Security enhancements**: Following security best practices

### Project Vision

MiniSearch aims to be a minimalist, privacy-focused web search application with AI assistance. We prioritize:
- Privacy and security
- Simplicity and ease of use
- Cross-platform compatibility
- Efficient resource usage

### Getting in Touch

- For questions about contributions: Use GitHub discussions
- For security issues: See [SECURITY.md](SECURITY.md)
- For general questions: Use GitHub issues

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests if applicable
5. Ensure all tests pass and linting succeeds
6. Commit your changes (`git commit -m 'Add some amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### Pull Request Guidelines

- Keep PRs focused on a single feature or fix
- Write clear commit messages
- Update documentation if needed
- Ensure your code follows the existing style
- Be responsive to feedback and reviews

## Development Commands

```bash
# Start development server
docker compose up

# Run tests
docker compose exec development-server npm run test

# Run linting
docker compose exec development-server npm run lint

# Build for production
docker compose -f docker-compose.production.yml build

# View test coverage
docker compose exec development-server npm run test:coverage
```

## Questions?

Don't hesitate to ask questions! We're here to help you contribute successfully.

---

Thanks again for your interest in contributing to MiniSearch! 🎉
