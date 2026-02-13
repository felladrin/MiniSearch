# MiniSearch Agent Guidelines

## Repository Map

This file serves as a table of contents. Detailed knowledge lives in the structured `docs/` directory.

### Quick Start
- **Development**: `docker compose up` (see `docs/development-commands.md`)
- **Lint**: `docker compose exec development-server npm run lint` (enforced via pre-commit hooks)

### Core Documentation

**Architecture & Design:**
- `docs/architecture.md` - System architecture and deployment
- `docs/design.md` - Design philosophy and principles
- `docs/project-structure.md` - Directory layout and organization
- `docs/overview.md` - Complete system overview and technical details

**Development:**
- `docs/development-commands.md` - All available commands
- `docs/coding-conventions.md` - Style guidelines and patterns
- `docs/pull-requests.md` - PR process and merge philosophy

**Technical:**
- `docs/core-technologies.md` - Technology stack and dependencies
- `docs/security.md` - Security model and access control

### Agent-First Principles

**Repository as System of Record:**
- All knowledge lives in versioned docs/ structure
- Progressive disclosure: start small, point to deeper sources
- Mechanical validation via linters and CI

**Agent Legibility:**
- Optimize codebase for agent reasoning, not human preferences
- Context is scarce - give agents a map, not a manual
- Push context into repo rather than external knowledge

**Architecture & Boundaries:**
- Enforce invariants, not implementations
- Strict boundaries enable speed without decay
- Custom linters with remediation instructions

**Autonomy & Feedback:**
- Treat failures as signals to improve the environment
- Build feedback loops and control systems for agents
- Combat entropy with recurring cleanup processes

## Technology Stack

React + TypeScript + Mantine UI, with privacy-first architecture.
See `docs/core-technologies.md` for complete dependency list and selection criteria.

## Entry Points

- **Browser**: `client/main.tsx` - React app initialization
- **Server**: `vite.config.ts` - Vite dev server with hooks
- **Container**: `Dockerfile` - Multi-stage build with SearXNG + Node.js

## Quality Assurance

- Biome for linting/formatting
- TypeScript strict mode
- Vitest for testing
- Pre-commit hooks via Husky

For detailed guidelines, see the structured documentation in `docs/`.
