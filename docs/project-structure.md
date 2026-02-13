# Project Structure

## Directory Layout

- **`client/`**: Frontend React application
  - **`components/`**: Feature-based UI components
    - **`App/`**: Main application component with error boundaries
    - **`AiResponse/`**: AI response display and chat interface components
    - **`Analytics/`**: Search analytics and statistics components
    - **`Logs/`**: Application logging and debug components
    - **`Pages/`**: Route-level page components
      - **`Main/`**: Main search interface with menu and settings
    - **`Search/`**: Search functionality components
      - **`Form/`**: Search input and form components
      - **`History/`**: Search history and saved searches
      - **`Results/`**: Search results display (textual and graphical)
    - **`Settings/`**: Application settings and configuration
  - **`modules/`**: Core business logic (PubSub stores, search services, database layers)
  - **`hooks/`**: Custom React hooks
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
