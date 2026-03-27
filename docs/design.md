# Design Philosophy

## Core Beliefs

1. **Privacy-First**: All data stays local, no tracking, no cloud dependencies
2. **Minimalist UI**: Clean, uncluttered interface focused on core functionality
3. **Browser-Based AI**: Models run locally in the browser when possible
4. **Efficient Resource Usage**: On-demand model loading and caching
5. **Open Source**: Transparent development, community contributions welcome

## Design Principles

### User Interface
- Minimal visual clutter with Mantine v8 components
- Clear hierarchy and information architecture
- Keyboard-first navigation with comprehensive shortcuts
- Semantic HTML and ARIA labels for WCAG 2.1 AA compliance
- Responsive design for desktop and mobile
- Dark mode support with high contrast options

### Performance
- Lazy loading for routes and components with React.lazy()
- Optimized bundle size using Vite 8 build optimizations
- Efficient state management with create-pubsub
- Caching strategies for search results and AI responses
- WebGPU detection and F16 shader support for optimal AI inference
- Bundle analysis with rollup-plugin-visualizer

### Accessibility
- WCAG 2.1 AA compliance
- Screen reader support
- Keyboard navigation
- High contrast mode support
- Focus indicators

## Component Design

- Feature-based component organization in `client/components/`
- Self-contained component folders with co-located tests
- Consistent use of Mantine UI v8 components and hooks
- Custom hooks for reusable logic in `client/hooks/`
- Business logic separated into `client/modules/`
- Proper TypeScript typing throughout with strict mode
- React 19 patterns with function components (no React.FC)

## Technology Integration

### AI & Search
- Multiple inference engines: WebLLM (WebGPU), Wllama, OpenAI-compatible APIs
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
