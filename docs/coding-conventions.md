# Coding Conventions

## Tech Stack

React 19 + TypeScript + Mantine UI v8 (`@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications`, `@mantine/code-highlight`, `@mantine/carousel`)

- **Build Tool**: Vite 8
- **Linting/Formatting**: Biome 2
- **Testing**: Vitest 4 + Testing Library
- **State Management**: create-pubsub
- **Routing**: Wouter 3
- **AI Integration**: WebLLM, Wllama, OpenAI-compatible APIs
- **Search**: SearXNG integration
- **Package Manager**: npm

## Style Guidelines

- Run `npm run lint` before committing (enforced via `husky`)
- Use Biome for formatting and linting (replaces ESLint/Prettier)
- Named function exports: `export function ComponentName` (not `React.FC`)
- Use `React.lazy()` for route-level components
- PascalCase for components/types, camelCase for functions/variables, UPPER_SNAKE_CASE for constants
- Double quotes for strings (Biome default)
- 2-space indentation (Biome default)

## TypeScript

- Use interfaces for data structures
- Avoid comments; use TSDoc only for public APIs
- Strict mode enabled - no `any` types
- React 19 types with strict TypeScript checking
- Path aliases configured: `@/` (client root), `@/modules`, `@/components`, `@/hooks`, `@shared`, `@root`

## State & Imports

- Use `create-pubsub` for global state (avoid nested context providers)
- Prefer absolute path aliases where configured (`@/` for client root)

## UI & Performance

- Use Mantine v8 components for consistency
- Ensure keyboard navigation, ARIA labels, semantic HTML
- Use `React.memo()` and `useCallback()` for optimization
- Lazy loading with Vite's dynamic imports
- Bundle analysis with rollup-plugin-visualizer
- WebGPU detection for optimal AI inference

## File Organization

- Components organized by feature domain in `client/components/`
- Each component folder is self-contained
- Business logic modules in `client/modules/`
- Hooks in dedicated `client/hooks/`
- Server-side code in `server/`
- Shared types and utilities in `shared/`
- Test files co-located with `.test.ts` suffix

## Testing

- Vitest for unit/integration tests
- Testing Library for component testing
- Coverage reports with `npm run test:coverage`
- Test files use `.test.ts` suffix
- Mock files in `client/modules/testUtils.ts`

## Related Topics

- **Project Structure**: `docs/project-structure.md` - Directory organization
- **Design**: `docs/design.md` - UI/UX principles
- **UI Components**: `docs/ui-components.md` - Component architecture
- **Pull Requests**: `docs/pull-requests.md` - Contribution workflow
