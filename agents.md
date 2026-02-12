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

## Core Technologies and Dependencies

**Frontend**:
- React + TypeScript with strict mode
- Mantine UI v7 (`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/carousel`)
- Vite build tool with React plugin
- AI SDK (`@ai-sdk/openai-compatible`) for unified AI interface

**AI & Search**:
- `@mlc-ai/web-llm` and `@wllama/wllama` for client-side AI inference
- `ai` package for AI integration
- SearXNG for privacy-focused metasearch

**Data & State**:
- `dexie` for IndexedDB management
- `create-pubsub` for state management (avoid React Context)
- `usePubSub` hook for component subscriptions

**Development Tools**:
- Biome for linting and formatting
- Vitest for testing
- TypeScript with strict mode
- Husky + lint-staged for pre-commit hooks

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

- **Privacy-First**: Local storage via Dexie.js (IndexedDB), all web searches routed through SearXNG without tracking
- **AI Inference**: Server-side (OpenAI, Horde) and client-side (WebLLM, Wllama) with optional browser-only mode
- **State Management**: PubSub pattern for decoupled state (no prop drilling) using `create-pubsub` package
- **Search Pipeline**: Server hooks handle validation, caching, compression, reranking with local llama-server
- **Multi-Service Container**: Single Docker container running SearXNG, llama-server, and Node.js concurrently
- **Data Persistence**: Dual-layer approach with 15-minute TTL cache for search results in IndexedDB

## Search and AI Integration Flow

**Text Generation Pipeline**:
- `textGeneration` module orchestrates search-to-response flow
- Search requests managed through server hooks with validation and caching
- Optional reranking using local llama-server before LLM processing
- Response streaming for real-time AI interactions

**AI Provider Support**:
- Server-side: OpenAI API, AI Horde
- Client-side: WebLLM, Wllama for browser-only mode
- Unified interface via AI SDK for consistent developer experience

## Build and Deployment Pipeline

**Multi-Stage Docker Build**:
- Builder stage compiles llama-server from source
- Final runtime image contains only necessary binaries
- Single container runs SearXNG, llama-server, and Node.js concurrently

**Development vs Production**:
- **Development**: HMR on port 7861, volume mounts, Vite dev server with source maps
- **Production**: Pre-built `/dist` assets, Vite preview server, optimized minification

**Quality Assurance**:
- Biome for linting and formatting
- TypeScript strict type checking  
- Vitest for testing
- Pre-commit hooks via Husky and lint-staged

## Configuration

- **Environment**: See `.env.example` for options
- **Docker Development**: `docker compose up`
- **Docker Production**: `docker compose -f docker-compose.production.yml up --build`

## System Design Philosophy

- **Layered Architecture**: Search, AI inference, and presentation concerns are separated
- **Privacy by Design**: AI processing can occur entirely client-side in the browser
- **Multi-Stage Docker Build**: Compiles llama-server from source, then creates runtime image
- **Development vs Production**: Supports HMR development mode and optimized production mode

## Application Entry Points

- **Browser Entry**: `client/main.tsx` - React app initialization with error boundaries
- **Server Entry**: `vite.config.ts` - Vite dev/preview server with hook registration
- **Container Entry**: `Dockerfile` - Starts SearXNG and Node.js in single process

## Access Control & Security

- **Optional Access Keys**: `ACCESS_KEYS` environment variable for usage restriction
- **Rate Limiting**: Applied to search and inference endpoints
- **Server-side Validation**: Access keys verified before proxying to SearXNG
- **Key Timeout**: `ACCESS_KEY_TIMEOUT_HOURS` controls cache duration
