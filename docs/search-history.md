---
# Search History System

## Overview
MiniSearch keeps a local-first record of every search so agents can resurface text results, image results, and generated responses without hitting remote services again. All persistence lives inside the browser via Dexie/IndexedDB and is never synced to external servers, preserving the privacy posture of the app.

## Data Model and Storage
The `HistoryDatabase` Dexie instance stores three related tables:

1. `searches` – canonical log of each query plus hydrated results payloads (text, image, run metadata, source, pin state).
2. `llmResponses` – snapshot of every AI answer tied to its originating search run, enabling restoration of the assistant output.
3. `chatHistory` – chronological record of chat turns (user/assistant roles) scoped by `conversationId` (the `searchRunId`).

All three tables share a `searchRunId` foreign key so restoring a specific run can bring back the search results, saved AI response, and chat transcript atomically. @client/modules/history.ts#86-367

## Cleanup Guarantees
To keep IndexedDB lean, inserts trigger `performCleanup()`, which enforces:

- **Retention window** – non-pinned entries older than `historyRetentionDays` are deleted in batches of 100.
- **Max entries** – if the total exceeds `historyMaxEntries`, the oldest unpinned rows past the limit are removed.
- **Pin protection** – pinned entries are skipped by both retention and max-entry sweeps.

Cleanup is gated by `historyAutoCleanup`, so advanced users can opt out. These knobs come from the settings store and can be updated at runtime. @client/modules/history.ts#147-200 @client/modules/settings.ts#7-52

## Hook API
`useSearchHistory` exposes the canonical API surface for components:

- Fetches recent searches (optionally paginated) and exposes filtered/grouped views.
- Provides fuzzy search, pin toggling, delete/clear operations, and error retry helpers.
- Keeps derived state such as grouped sections (Today/Yesterday/etc.) in sync with the settings flag `historyGroupByDate`.
- Refreshes itself on an interval so the History UI stays live even if other tabs mutate the DB.

Because the hook writes via Dexie directly, any component can call `addToHistory` to persist new runs immediately after text or image searches resolve. @client/hooks/useSearchHistory.ts#1-372

## UI Surfaces
- **History Drawer** – wraps the hook data in a drawer with filtering, pin/delete affordances, grouped stacks, and an Analytics tab powered by `SearchStats` in compact mode. The drawer guards against disabled history settings and mirrors the hook filtered list in real time. @client/components/Search/History/HistoryDrawer.tsx#35-315
- **History Button** – lazy-loads the drawer and logs open/close events for observability. @client/components/Search/History/HistoryButton.tsx#18-56
- **History Restore** – recreates full search state (query string, search results, AI response, and chat transcript) when a user replays an entry. @client/hooks/useHistoryRestore.ts#32-105

## Settings Surface
`HistorySettings` wires Mantine form controls to the settings pub/sub so users can toggle history, adjust retention/max entries, and clear all rows (with confirmation + toast feedback). It relies on the same hook to know when the table is empty before enabling destructive actions. @client/components/Settings/HistorySettings.tsx#24-152

## Analytics Integration
The History Drawer Analytics tab renders the compact `SearchStats` cards scoped to `period="all"`, giving total searches, daily averages, and most active hours pulled from the same IndexedDB data. Keeping analytics co-located ensures the metrics share the hook filtering and cleanup guarantees.
