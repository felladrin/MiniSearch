# Coding Conventions

## Tech Stack

React + TypeScript + Mantine UI (`@mantine/core`, `@mantine/hooks`, `@mantine/form`)

## Style Guidelines

- Run `npm run format` before committing (enforced via `husky` and `lint-staged`)
- Named function exports: `export function ComponentName` (not `React.FC`)
- Use `React.lazy()` for route-level components
- PascalCase for components/types, camelCase for functions/variables, UPPER_SNAKE_CASE for constants

## TypeScript

- Use interfaces for data structures
- Avoid comments; use TSDoc only for public APIs
- Strict mode enabled - no `any` types

## State & Imports

- Use `create-pubsub` for global state (avoid nested context providers)
- Prefer absolute path aliases where configured (`@/` for client root)

## UI & Performance

- Use Mantine components for consistency
- Ensure keyboard navigation, ARIA labels, semantic HTML
- Use `React.memo()` and `useCallback()` for optimization

## File Organization

- Components organized by feature domain
- Each component folder is self-contained
- Hooks in dedicated `hooks/` directories
- Shared utilities in `shared/` or component-level `utils/`

## Error Handling

- Use error boundaries for React components
- Proper TypeScript error types
- Graceful degradation for AI features
