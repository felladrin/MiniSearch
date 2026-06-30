# Design Philosophy

## Core Beliefs

1. **Privacy-First**: All data stays local, no tracking, no cloud dependencies
2. **Minimalist UI**: Clean, uncluttered interface focused on core functionality
3. **Browser-Based AI**: Models run locally in the browser when possible
4. **Efficient Resource Usage**: On-demand model loading and caching
5. **Open Source**: Transparent development, community contributions welcome

## Design Principles

### User Interface
- Minimal visual clutter with Mantine v9 components
- Clear hierarchy and information architecture
- Keyboard-first navigation with comprehensive shortcuts
- Semantic HTML and ARIA labels for WCAG 2.1 AA compliance
- Responsive design for desktop and mobile
- Dark mode by default (via Mantine's `MantineProvider`)

### Performance
- Lazy loading for routes and components with React.lazy()
- Optimized bundle size using Vite 8 build optimizations
- Efficient state management with create-pubsub
- Caching strategies for search results and AI responses
- WebGPU detection for automatic GPU-accelerated inference
- Bundle analysis with rollup-plugin-visualizer

### Accessibility
- WCAG-aligned where implemented
- Screen reader support
- Keyboard navigation
- ARIA labels on select interactive elements (e.g. chat input, history actions)
- Focus indicators

## Component Design

- Feature-based component organization in `client/components/`
- Tests co-located for select components (e.g. SearchForm, MainPage, SearchResultsSection); broader test coverage is still being built out
- Consistent use of Mantine UI v9 components and hooks
- Custom hooks for reusable logic in `client/hooks/`
- Business logic separated into `client/modules/`
- Proper TypeScript typing throughout with strict mode
- React 19 patterns with function components (no React.FC)

## Technology Integration

### AI & Search
- Multiple inference engines: Wllama (WebGPU or CPU), OpenAI-compatible APIs
- Privacy-first local processing when possible
- SearXNG integration for web search
- Graceful fallbacks for unsupported browsers

### Development Experience
- Hot Module Replacement with Vite
- Biome for consistent formatting and linting
- Comprehensive testing with Vitest and Testing Library
- Docker-based development environment

## Related Topics

- **UI Components**: `docs/ui-components.md` - Component implementation details
- **Project Structure**: `docs/project-structure.md` - Directory organization
- **Coding Conventions**: `docs/coding-conventions.md` - Code style guidelines
