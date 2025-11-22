# Repository Guidelines

## Project Structure

- **`client/`**: Frontend React application
  - **`components/`**: Feature-based UI components (`Search`, `AiResponse`, `Analytics`). Each folder is self-contained with related styles, hooks, and utilities.
  - **`modules/`**: Core business logic (PubSub stores, search services, database layers)
  - **`hooks/`**: Custom React hooks
  - **`public/`**: Static assets
- **`server/`**: Server hooks for search endpoints, caching, compression, CORS, and API validation
- **`shared/`**: Utilities shared between client and server
- **`vite.config.ts`**: Build and server configuration with environment-driven feature flags

## Development Commands

- **`npm run dev`**: Start development server with HMR
- **`npm run build`**: Compile for production
- **`npm run start`**: Preview production build
- **`npm run lint`**: Check code quality (Biome, TypeScript, dependencies)
- **`npm run format`**: Auto-format code with Biome

## Coding Conventions

**Tech Stack**: React + TypeScript + Mantine UI (`@mantine/core`, `@mantine/hooks`, `@mantine/form`)

**Style**:

- Run `npm run format` before committing (enforced via `husky` and `lint-staged`)
- Named function exports: `export function ComponentName` (not `React.FC`)
- Use `React.lazy()` for route-level components
- PascalCase for components/types, camelCase for functions/variables, UPPER_SNAKE_CASE for constants

**TypeScript**:

- Use interfaces for data structures
- Avoid comments; use TSDoc only for public APIs

**State & Imports**:

- Use `create-pubsub` for global state (avoid nested context providers)
- Prefer absolute path aliases where configured

**UI & Performance**:

- Use Mantine components for consistency
- Ensure keyboard navigation, ARIA labels, semantic HTML
- Use `React.memo()` and `useCallback()` for optimization

## Pull Requests

- Ensure `npm run lint` pass
- Keep PRs focused on a single feature or fix
- Include clear descriptions and screenshots for UI changes
- Write descriptive commit messages

## Architecture

- **Privacy-First**: Local storage via Dexie.js (IndexedDB)
- **AI Inference**: Server-side (OpenAI, Horde) and client-side (WebLLM, Wllama)
- **State Management**: PubSub pattern for decoupled state (no prop drilling)
- **Search Pipeline**: Server hooks handle validation, caching, compression, reranking

## Configuration

- **Environment**: See `.env.example` for options
- **Docker Development**: `docker compose up`
- **Docker Production**: `docker compose -f docker-compose.production.yml up --build`
