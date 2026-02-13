# Architecture

## Core Principles

- **Privacy-First**: Local storage via Dexie.js (IndexedDB), all web searches routed through SearXNG without tracking
- **AI Inference**: Server-side (OpenAI, Horde) and client-side (WebLLM, Wllama) with optional browser-only mode
- **State Management**: PubSub pattern for decoupled state (no prop drilling) using `create-pubsub` package
- **Layered Architecture**: Search, AI inference, and presentation concerns are separated
- **Privacy by Design**: AI processing can occur entirely client-side in the browser

## System Components

### Search Pipeline
- Server hooks handle validation, caching, compression, reranking with local llama-server
- Search requests managed through server hooks with validation and caching
- Optional reranking using local llama-server before LLM processing

### AI Integration
- Server-side: OpenAI API, AI Horde
- Client-side: WebLLM, Wllama for browser-only mode
- Unified interface via AI SDK for consistent developer experience
- Response streaming for real-time AI interactions

### Data Persistence
- Dual-layer approach with 15-minute TTL cache for search results in IndexedDB
- All data stored locally, no cloud sync
- Privacy-focused design with no tracking

## Deployment Architecture

### Multi-Stage Docker Build
- Builder stage compiles llama-server from source
- Final runtime image contains only necessary binaries
- Single container runs SearXNG, llama-server, and Node.js concurrently

### Development vs Production
- **Development**: HMR on port 7861, volume mounts, Vite dev server with source maps
- **Production**: Pre-built `/dist` assets, Vite preview server, optimized minification

## Application Entry Points

- **Browser Entry**: `client/main.tsx` - React app initialization with error boundaries
- **Server Entry**: `vite.config.ts` - Vite dev/preview server with hook registration
- **Container Entry**: `Dockerfile` - Starts SearXNG and Node.js in single process

## Access Control & Security

- **Optional Access Keys**: `ACCESS_KEYS` environment variable for usage restriction
- **Rate Limiting**: Applied to search and inference endpoints
- **Server-side Validation**: Access keys verified before proxying to SearXNG
- **Key Timeout**: `ACCESS_KEY_TIMEOUT_HOURS` controls cache duration
