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

## Quality Assurance

- **`docker compose exec development-server npm run lint`**: Biome linting, TypeScript checking, and dependency validation
- **`docker compose exec development-server npm run format`**: Format code with Biome (enforced via pre-commit hooks)

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - Environment variables
- **Pull Requests**: `docs/pull-requests.md` - Contribution workflow
