# MiniSearch Overview

## System Purpose and Design Philosophy

MiniSearch serves as a privacy-preserving search interface with optional AI augmentation. The system prioritizes user privacy by routing all web searches through SearXNG, which aggregates results from multiple search engines without tracking. AI processing can occur entirely client-side in the browser, ensuring no user queries or responses leave the device.

The architecture follows a layered design where search, AI inference, and presentation concerns are separated.

## Core Technologies and Dependencies

MiniSearch integrates multiple technology stacks within a unified deployment container:

### Frontend
- **React** - UI framework
- **React DOM** - DOM rendering
- **Mantine UI** - Component library (`@mantine/core`, `@mantine/hooks`, `@mantine/carousel`)
- **Vite** - Build tool with React plugin
- **TypeScript** - Type safety

### AI & Search
- **@mlc-ai/web-llm** - Client-side AI inference
- **@wllama/wllama** - Alternative client-side inference
- **AI SDK** - AI integration layer
- **@ai-sdk/openai-compatible** - Unified AI interface

### Data & State
- **Dexie** - IndexedDB management
- **create-pubsub** - State management (avoid React Context)
- **usePubSub** - Component subscriptions

## Application Entry Points

The application has three primary entry points:

1. **Browser Entry**: `client/index.tsx` initializes the React application, mounting the root component and setting up error boundaries.

2. **Server Entry**: `vite.config.ts` configures the Vite development and preview servers, registering server hooks for search and inference endpoints.

3. **Container Entry**: `Dockerfile` starts both SearXNG and the Node.js server in a single process via shell command composition.

## Multi-Service Container Architecture

The Docker container runs three services concurrently:
- **SearXNG** - Privacy-focused metasearch engine
- **llama-server** - Local AI inference server
- **Node.js application** - Main application server

The multi-stage build process first compiles llama-server from source, then creates the final runtime image with Node.js and Python environments. The container entrypoint starts SearXNG in the background and then launches the Node.js application.

## State Management Architecture

MiniSearch uses a PubSub pattern for state management rather than React Context, enabling loose coupling between components and business logic modules:

PubSub channels are created using the create-pubsub package and provide type-safe publish/subscribe interfaces. Components subscribe via the usePubSub hook, and business logic modules publish state updates directly.

## Data Persistence Strategy

MiniSearch employs a dual-layer persistence approach:
- **IndexedDB** - Local storage for search history, settings, cached results, and saved AI transcripts
- **TTL-based caching** - 15-minute cache for search results to minimize API calls

Search history is backed by a Dexie database that keeps three coordinated tables (search runs, LLM responses, chat turns) along with automatic retention/max-entry cleanup. See `docs/search-history.md` for the complete schema and invariants. The caching layer minimizes redundant API calls to SearXNG while maintaining fresh results. Search results cached in IndexedDB have a 15-minute TTL, after which new searches bypass the cache.

Long-running chat sessions use an in-memory conversation summary that rolls excess turns into a structured digest before continuing generation. Details about the token budgeting and summary refresh flow live in `docs/conversation-memory.md`.

## Development and Production Modes

The system supports two operational modes:

### Development Mode
- Hot module replacement (HMR) on port 7861
- Volume mount for live code updates
- Vite dev server with source maps

### Production Mode
- Pre-built static assets in /dist
- Vite preview server (no HMR)
- Optimized bundle with minification

Both modes run the same underlying services (SearXNG, llama-server) but differ in how the frontend is served and rebuilt.

## Search and AI Integration Flow

The textGeneration module orchestrates the entire search-to-response flow, managing search requests, LLM context preparation, and response streaming. Search results are optionally reranked using a local llama-server instance before being passed to the LLM for response generation.

## Build and Deployment Pipeline

The build pipeline uses Biome for linting and formatting, TypeScript for type checking, and Vitest for testing. The Docker build compiles native dependencies from source in a builder stage, then copies only the necessary binaries to the final runtime image.

## Access Control and Security

MiniSearch supports optional access key authentication for restricting usage. When the ACCESS_KEYS environment variable is set, the server validates incoming requests against the configured keys. Rate limiting is applied to search and inference endpoints to prevent abuse.

Access keys are verified server-side before proxying requests to SearXNG or processing inference requests. The ACCESS_KEY_TIMEOUT_HOURS variable controls how long a valid access key remains cached.

For complete security details, see `docs/security.md`.

## Related Topics

- **Quick Start**: `docs/quick-start.md` - Installation and first run
- **Configuration**: `docs/configuration.md` - All environment variables and settings
- **AI Integration**: `docs/ai-integration.md` - Detailed AI inference options
- **UI Components**: `docs/ui-components.md` - Component architecture and state management
- **Search History**: `docs/search-history.md` - History database and management
- **Conversation Memory**: `docs/conversation-memory.md` - Token budgeting and summaries
- **Security**: `docs/security.md` - Access control and privacy model
- **Development**: `docs/development-commands.md` - Available commands
