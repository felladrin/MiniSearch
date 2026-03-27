# Project Structure

## Directory Layout

- **`client/`**: Frontend React application
  - **`components/`**: Feature-based UI components
    - **`App/`**: Main application component with error boundaries
    - **`AiResponse/`**: AI response display and chat interface components
    - **`Analytics/`**: Search analytics and statistics components
    - **`Logs/`**: Application logging and debug modal components
    - **`Pages/`**: Route-level page components
      - **`Main/`**: Main search interface with menu and settings
    - **`Search/`**: Search functionality components
      - **`Form/`**: Search input and form components
      - **`History/`**: Search history and saved searches
      - **`Results/`**: Search results display (textual and graphical)
    - **`Settings/`**: Application settings and configuration
  - **`hooks/`**: Custom React hooks
  - **`modules/`**: Core business logic (PubSub stores, search services, database layers)
  - **`public/`**: Static assets
- **`server/`**: Server hooks for search endpoints, caching, compression, CORS, and API validation
- **`shared/`**: Utilities shared between client and server
- **`vite.config.ts`**: Build and server configuration with environment-driven feature flags

## Component Organization

Components are organized by feature domain. Each component folder contains:
- Component implementation
- Related styles
- Custom hooks
- Utility functions
- Tests

This self-contained structure makes it easy for agents to understand and modify components without navigating across the codebase.

## Key Modules Reference

The `client/modules/` directory contains core business logic organized by domain:

| Module | Purpose |
|--------|---------|
| `pubSub.ts` | All PubSub channels for state management |
| `search.ts` | Search orchestration, caching, and reranking |
| `textGeneration.ts` | AI response generation and chat handling |
| `textGenerationWith*.ts` | Provider-specific inference implementations (WebLLM, Wllama, OpenAI, Horde, Internal API) |
| `history.ts` | IndexedDB persistence for searches and chat |
| `settings.ts` | Default settings and inference type definitions |
| `followUpQuestions.ts` | Generates contextual follow-up questions |
| `relatedSearchQuery.ts` | Creates related search queries from conversation |
| `querySuggestions.ts` | Query suggestion UI data management |
| `webGpu.ts` | WebGPU availability and F16 shader detection |
| `wllama.ts` | Wllama model configuration and management |
| `accessKey.ts` | Access key validation and storage |
| `searchTokenHash.ts` | CSRF protection token generation |
| `parentWindow.ts` | PostMessage API for parent window embedding |
| `logEntries.ts` | Application logging with unique IDs |
| `appInfo.ts` | Application metadata and version info |
| `keyboard.ts` | Keyboard shortcut handling |
| `systemPrompt.ts` | System prompt templates |
| `stringFormatters.ts` | Text formatting utilities |
| `types.ts` | Shared TypeScript type definitions |

## Related Topics

- **Overview**: `docs/overview.md` - System architecture and data flow
- **UI Components**: `docs/ui-components.md` - Component architecture and PubSub patterns
- **Quick Start**: `docs/quick-start.md` - Installation and setup
