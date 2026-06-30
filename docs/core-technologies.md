# Core Technologies and Dependencies

## Frontend

- **React + TypeScript**: Strict mode enabled for type safety
- **Mantine UI v9**: Component library (`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/carousel`, `@mantine/code-highlight`, `@mantine/notifications`)
- **Vite**: Build tool with React plugin and HMR
- **AI SDK**: `@ai-sdk/openai-compatible` for unified AI interface

## AI & Search

- **`@wllama/wllama`**: Client-side AI inference (WebGPU-accelerated or CPU via WebAssembly)
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
- **Husky**: Pre-commit hooks (runs `biome check --write --staged` directly)

## Technology Selection Criteria

Technologies are chosen based on:
- **Agent legibility**: Easy for agents to model and reason about
- **Stability**: Mature, well-documented libraries
- **Composability**: Clean APIs that work well together
- **Local-first**: Privacy-focused, minimal external dependencies
