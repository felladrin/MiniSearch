# MiniSearch Agent Guidelines

This is your navigation hub. Start here, follow the links, and return when you need orientation.

## Before You Start

**New to this codebase?** Read in this order:
1. `docs/quick-start.md` - Get it running
2. `docs/overview.md` - Understand the system
3. `docs/project-structure.md` - Navigate the code

**Making changes?** Check:
- `docs/coding-conventions.md` - Code style
- `docs/development-commands.md` - Available commands
- `docs/pull-requests.md` - How to submit

## Repository Map

### Getting Started
- **`docs/quick-start.md`** - Installation, first run, verification
- **`docs/overview.md`** - System architecture and data flow
- **`docs/project-structure.md`** - Directory layout and component organization

### Configuration & Setup
- **`docs/configuration.md`** - Environment variables and settings reference
- **`docs/security.md`** - Access control, privacy, and security model

### Core Functionality
- **`docs/ai-integration.md`** - AI inference types (WebLLM, Wllama, OpenAI, AI Horde, Internal)
- **`docs/ui-components.md`** - Component architecture and PubSub patterns
- **`docs/search-history.md`** - History database schema and management
- **`docs/conversation-memory.md`** - Token budgeting and rolling summaries

### Development
- **`docs/development-commands.md`** - Docker, npm, and testing commands
- **`docs/coding-conventions.md`** - Style guide and patterns
- **`docs/pull-requests.md`** - PR process and merge philosophy
- **`docs/core-technologies.md`** - Technology stack and dependencies
- **`docs/design.md`** - UI/UX design principles

## Agent Decision Tree

```
Need to:
├── Add a feature?
│   ├── UI component → docs/ui-components.md
│   ├── AI integration → docs/ai-integration.md
│   ├── Search functionality → client/modules/search.ts
│   └── Settings option → docs/configuration.md
├── Fix a bug?
│   ├── UI issue → Check component + PubSub channels
│   ├── AI not working → docs/ai-integration.md + browser console
│   ├── Search failing → Check SearXNG + server hooks
│   └── Build error → docs/development-commands.md
├── Configure deployment?
│   ├── Environment variables → docs/configuration.md
│   ├── Access control → docs/security.md
│   └── Docker setup → docs/overview.md
└── Understand data flow?
    ├── Search flow → client/modules/search.ts
    ├── AI generation → client/modules/textGeneration.ts
    ├── State management → docs/ui-components.md
    └── History/Chat → docs/search-history.md + docs/conversation-memory.md
```

## Key Files Reference

### Entry Points
- `client/main.tsx` - React app initialization
- `vite.config.ts` - Vite dev server with hooks
- `Dockerfile` - Multi-stage container build

### Core Modules (Business Logic)
- `client/modules/search.ts` - Search orchestration and caching
- `client/modules/textGeneration.ts` - AI response flow
- `client/modules/pubSub.ts` - All PubSub channels
- `client/modules/settings.ts` - Settings management
- `client/modules/history.ts` - Search history database

### Server-Side
- `server/searchEndpointServerHook.ts` - `/search` endpoints
- `server/internalApiEndpointServerHook.ts` - `/inference` proxy
- `server/webSearchService.ts` - SearXNG integration
- `server/rerankerService.ts` - Local result reranking

### Components (Key)
- `client/components/App/` - Application shell
- `client/components/Search/Form/` - Search input
- `client/components/Search/Results/` - Results display
- `client/components/AiResponse/` - AI response + chat
- `client/components/Pages/Main/Menu/` - Settings drawers

## Common Tasks Quick Reference

### Add a new AI model
1. Add to `client/modules/wllama.ts` or WebLLM registry
2. Update `docs/ai-integration.md`
3. Update `docs/configuration.md` defaults

### Add a new setting
1. Add to `client/modules/settings.ts` default object
2. Add UI in `client/components/Pages/Main/Menu/`
3. Update `docs/configuration.md` settings table

### Modify search behavior
1. Edit `client/modules/search.ts`
2. Update `server/webSearchService.ts` if server-side changes needed
3. Check `server/rerankerService.ts` if reranking affected

### Fix UI state issues
1. Check PubSub channels in `client/modules/pubSub.ts`
2. Verify component subscriptions in `docs/ui-components.md`
3. Ensure proper state updates in business logic modules

### Analyze test coverage
1. Run `npm run test:coverage` to generate reports
2. Check `coverage/coverage-summary.json` for quick metrics
3. See `docs/development-commands.md` for full coverage analysis guide

## Quality Gates

Before any change:
```bash
docker compose exec development-server npm run lint
```

This runs:
- Biome (formatting/linting)
- TypeScript (type checking)
- ts-prune (dead code detection)
- jscpd (copy-paste detection)
- dpdm (circular dependency detection)
- Custom architectural linter

## Agent-First Principles

**Repository as System of Record:**
- All knowledge lives in versioned docs/ structure
- This file is your entry point - start here
- Follow links, don't assume - verify in code

**Context Efficiency:**
- Use this map to navigate quickly
- Return to this file when context drifts
- Follow the decision tree for common tasks

**Architecture & Boundaries:**
- Respect PubSub boundaries - don't cross concerns
- Client vs server - keep them separate
- Feature-based organization - one folder per feature

**Documentation Maintenance:**
- Update these docs when you learn something new
- Add cross-references when linking concepts
- Keep examples current with actual code

## Technology Stack

React + TypeScript + Mantine UI v8, with privacy-first architecture.
See `docs/core-technologies.md` for complete dependency list and selection criteria.

## Need Help?

1. Check relevant doc in `docs/`
2. Read the module code in `client/modules/` or `server/`
3. Look at similar existing implementations
4. Run `npm run lint` to validate changes
