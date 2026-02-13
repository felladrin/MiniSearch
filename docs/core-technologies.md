# Core Technologies and Dependencies

## Frontend

- **React + TypeScript**: Strict mode enabled for type safety
- **Mantine UI v7**: Component library (`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/carousel`)
- **Vite**: Build tool with React plugin and HMR
- **AI SDK**: `@ai-sdk/openai-compatible` for unified AI interface

## AI & Search

- **`@mlc-ai/web-llm`**: Client-side AI inference
- **`@wllama/wllama`**: Alternative client-side inference
- **`ai` package**: AI integration layer
- **SearXNG**: Privacy-focused metasearch engine

## Data & State

- **`dexie`**: IndexedDB management for local storage
- **`create-pubsub`**: State management (avoid React Context)
- **`usePubSub`**: Component subscriptions to PubSub stores

## Development Tools

- **Biome**: Linting and formatting
- **Vitest**: Testing framework
- **TypeScript**: Strict mode enabled
- **Husky + lint-staged**: Pre-commit hooks

## Technology Selection Criteria

Technologies are chosen based on:
- **Agent legibility**: Easy for agents to model and reason about
- **Stability**: Mature, well-documented libraries
- **Composability**: Clean APIs that work well together
- **Local-first**: Privacy-focused, minimal external dependencies
