# UI Components

## Architecture Overview

MiniSearch uses a **PubSub-based reactive architecture**. Components subscribe to state changes via channels rather than props drilling or Context API.

### PubSub Pattern

Each PubSub channel is a three-element tuple returned by `createPubSub`:

| Index | Name | Role |
|-------|------|------|
| `[0]` | `update*` | Setter — publishes a new value to all subscribers |
| `[1]` | `onValueChange` / `subscribe*` / `listen*` | Subscription registration — receives every future value |
| `[2]` | `get*` | Getter — reads the current value synchronously |

These are destructured at module level in `pubSub.ts` and exported under descriptive names (e.g., `updateTextGenerationState`, `listenToSettingsChanges`, `getQuery`).

```typescript
// Component subscribes to state
const query = usePubSub(queryPubSub);

// Any module can update state
updateQuery('new query');

// All subscribers automatically re-render
```

**Benefits:**
- **Decoupling** — Modules (text generation, search, React components) read and write shared state without importing each other directly
- **No provider boilerplate** — Unlike React Context or Redux, no `Provider` wrapper needed; any module imports a channel from `pubSub.ts`
- **Selective subscriptions** — Components subscribe only to channels they use; a streaming token update throttling `responsePubSub` does not trigger re-renders in unrelated components
- **Persistence as a decorator** — `createLocalStoragePubSub` layers persistence transparently onto the same interface; consumers don't need to know whether a channel is persisted or ephemeral

### localStorage Persistence

Some state must survive page reloads. The `createLocalStoragePubSub` helper wraps `createPubSub` with two behaviors:

1. **Hydration** — On first call, reads existing value from `localStorage` via `localStorage.getItem(key)`. If a stored JSON string is found, it is parsed and used as the initial value; otherwise the default value is used
2. **Persistence** — A subscriber is immediately registered on the inner PubSub that calls `localStorage.setItem` with the JSON-serialized new value on every state change

Channels using this pattern: `settingsPubSub`, `querySuggestionsPubSub`, `lastSearchTokenHashPubSub`, `menuExpandedAccordionsPubSub`.

### Throttling High-Frequency Updates

Streaming LLM output produces token-by-token state changes that would overwhelm React's rendering pipeline. Two channels apply `throttle` from `throttleit` to cap subscriber notification rate to ~12 updates/sec (83.3ms interval):

| Export | Raw Updater | Throttle Interval |
|--------|-------------|-------------------|
| `updateResponse` | `responsePubSub[0]` | 1000 / 12 ms |
| `updateReasoningContent` | `reasoningContentPubSub[0]` | 1000 / 12 ms |

Callers write streaming token output directly to these exports without awareness of internal throttling.

### Side Effects

Three channels register built-in side-effect subscribers at module load time, independently of any React component lifecycle, for automatic logging via `addLogEntry`:

| Channel | Side Effect |
|---------|-------------|
| `textGenerationStatePubSub` | Logs state transitions |
| `textSearchStatePubSub` | Logs state transitions |
| `imageSearchStatePubSub` | Logs state transitions |

## PubSub Channel Reference

All state channels are defined in `client/modules/pubSub.ts`:

| Channel | Type | Description | Primary Consumers |
|---------|------|-------------|-------------------|
| `queryPubSub` | `string` | Current search query | SearchForm, SearchButton |
| `responsePubSub` | `string` | AI response content (throttled: 12/sec) | AiResponseSection |
| `reasoningContentPubSub` | `string` | AI reasoning/thinking content (throttled: 12/sec) | AiResponseSection |
| `settingsPubSub` | `Settings` | Application settings | SettingsForm, various components |
| `textSearchResultsPubSub` | `TextSearchResults` | Text search results | SearchResultsSection |
| `llmTextSearchResultsPubSub` | `TextSearchResults` | LLM-reranked text results | Internal use |
| `imageSearchResultsPubSub` | `ImageSearchResults` | Image search results | ImageResultsSection |
| `textSearchStatePubSub` | `SearchState` | Text search state: `"idle" \| "running" \| "failed" \| "completed"` | SearchResultsSection, LoadingIndicators |
| `imageSearchStatePubSub` | `SearchState` | Image search state: `"idle" \| "running" \| "failed" \| "completed"` | ImageResultsSection |
| `textGenerationStatePubSub` | `TextGenerationState` | AI generation state | AiResponseSection, StatusIndicators |
| `modelLoadingProgressPubSub` | `number` | Model download progress (0-100) | AiResponseSection |
| `modelSizeInMegabytesPubSub` | `number` | Model size in MB for progress calc | AiResponseSection |
| `chatMessagesPubSub` | `ChatMessage[]` | Chat conversation | ChatInterface |
| `chatInputPubSub` | `string` | Current chat input content | ChatInputArea |
| `chatGenerationStatePubSub` | `{isGeneratingResponse, isGeneratingFollowUpQuestion}` | Chat generation states | ChatInterface |
| `conversationSummaryPubSub` | `{id, summary}` | Rolling conversation summary | TextGeneration module |
| `followUpQuestionPubSub` | `string` | Generated follow-up question | AiResponseSection |
| `suppressNextFollowUpPubSub` | `boolean` | Flag to skip next follow-up | FollowUpQuestions module |
| `isRestoringFromHistoryPubSub` | `boolean` | History restoration in progress | SearchForm, components |
| `menuExpandedAccordionsPubSub` | `string[]` | Expanded menu accordion IDs | MenuDrawer |
| `querySuggestionsPubSub` | `string[]` | Query suggestions history | SearchForm |
| `lastSearchTokenHashPubSub` | `string` | Hash of last search token | Security/validation |
| `logEntriesPubSub` | `LogEntry[]` | Application log entries | LogsModal, ShowLogsButton |

## Component Hierarchy

```
App
├── AccessPage (if access keys enabled)
└── MainPage
    ├── SearchForm
    │   ├── HistoryButton
    │   │   └── HistoryDrawer (lazy-loaded)
    │   └── MenuButton
    │       └── MenuDrawer
    │           ├── AISettingsForm
    │           ├── SearchSettingsForm
    │           ├── InterfaceSettingsForm
    │           ├── HistorySettings
    │           ├── VoiceSettingsForm
    │           └── ActionsForm
    ├── SearchResultsSection
    │   ├── TextSearchResults
    │   │   └── SearchResultsList
    │   └── ImageSearchResults
    │       └── ImageResultsList
    └── AiResponseSection
        ├── AiResponseContent
        │   └── FormattedMarkdown
        └── ChatInterface (shown once generation is completed)
            ├── ChatHeader
            ├── MessageList
            └── ChatInputArea
```

## Key Components

### App (`client/components/App/`)

**Responsibility:** Application shell and routing

**Logic:**
```typescript
// App.tsx
// Access key validation is handled via useAccessKeyValidation hook
// which checks localStorage for a stored key hash and verifies it server-side
// Renders <AccessPage /> if validation fails, <MainPage /> otherwise
```

**Subscribes to:** None directly; validation state managed by `useAccessKeyValidation` hook

### SearchForm (`client/components/Search/Form/`)

**Responsibility:** Query input and search initiation

**PubSub:**
- **Subscribes:** `queryPubSub`, `textSearchStatePubSub`
- **Updates:** `queryPubSub` (on type), triggers `searchAndRespond()` (on submit)

**Logic:**
```typescript
function SearchForm() {
  const [query, setQuery] = usePubSub(queryPubSub);
  const [searchState] = usePubSub(textSearchStatePubSub);
  
  const handleSubmit = () => {
    searchAndRespond();
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button disabled={searchState === 'running'}>
        {searchState === 'running' ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
}
```

### SearchResultsSection (`client/components/Search/Results/`)

**Responsibility:** Display search results (text and images)

**PubSub:**
- **Subscribes:** `textSearchResultsPubSub`, `imageSearchResultsPubSub`, `textSearchStatePubSub`

**Logic:**
```typescript
function SearchResultsSection() {
  const [textResults] = usePubSub(textSearchResultsPubSub);
  const [imageResults] = usePubSub(imageSearchResultsPubSub);
  const [searchState] = usePubSub(textSearchStatePubSub);
  
  if (searchState === 'running') return <LoadingSkeleton />;
  if (searchState === 'failed') return <ErrorMessage />;
  
  return (
    <>
      <SearchResultsList searchResults={textResults} />
      {settings.enableImageSearch && <ImageResultsList searchResults={imageResults} />}
    </>
  );
}
```

### AiResponseSection (`client/components/AiResponse/`)

**Responsibility:** AI response display and chat interface

**PubSub:**
- **Subscribes:** `responsePubSub`, `textGenerationStatePubSub`, `chatMessagesPubSub`

**State Machine (`textGenerationStatePubSub`):**

| State | Description | UI Display |
|-------|-------------|------------|
| `idle` | No active generation | Hidden or empty |
| `awaitingModelDownloadAllowance` | Waiting for user to confirm model download | `AiModelDownloadAllowanceContent` confirmation prompt |
| `loadingModel` | Downloading or initializing AI model | `LoadingModelContent` with progress |
| `awaitingSearchResults` | Waiting for search to complete | `PreparingContent` indicator |
| `preparingToGenerate` | Search done, response not yet started | `PreparingContent` indicator |
| `generating` | Streaming response tokens | Active response with streaming text |
| `interrupted` | Generation manually stopped by user | Response retained, with a yellow "Interrupted" badge |
| `completed` | Full response received | Complete response with chat interface |
| `failed` | Error occurred | Error message with retry option |

**Reasoning Content Extraction:**

When models output internal thought processes, the UI extracts reasoning content bounded by `reasoningStartMarker` and `reasoningEndMarker` markers. Reasoning is displayed separately from the final response in a collapsible section.

**Logic:**
```typescript
function AiResponseSection() {
  const [response] = usePubSub(responsePubSub);
  const [textGenerationState] = usePubSub(textGenerationStatePubSub);
  const [chatMessages] = usePubSub(chatMessagesPubSub);

  if (["generating", "interrupted", "completed", "failed"].includes(textGenerationState)) {
    return (
      <>
        <AiResponseContent textGenerationState={textGenerationState} response={response} />
        {textGenerationState === "completed" && (
          <ChatInterface initialResponse={response} initialMessages={chatMessages} />
        )}
      </>
    );
  }

  if (textGenerationState === "loadingModel") return <LoadingModelContent />;
  if (["preparingToGenerate", "awaitingSearchResults"].includes(textGenerationState)) {
    return <PreparingContent textGenerationState={textGenerationState} />;
  }
  if (textGenerationState === "awaitingModelDownloadAllowance") {
    return <AiModelDownloadAllowanceContent />;
  }

  return null;
}
```

### MenuDrawer (`client/components/Pages/Main/Menu/`)

**Responsibility:** Application settings UI

**Sub-components:**
- **AISettingsForm:** Model selection, inference type, reasoning markers (sampling parameters such as temperature are hardcoded, not user-configurable)
- **SearchSettingsForm:** Result limits, image search toggle
- **InterfaceSettingsForm:** UI preferences
- **HistorySettings:** Retention days, max entries
- **VoiceSettingsForm:** TTS voice selection
- **ActionsForm:** Data management actions

**PubSub:**
- **Subscribes/Updates:** `settingsPubSub` (full settings object)

**Persistence:**
```typescript
// client/modules/pubSub.ts
export const settingsPubSub = createLocalStoragePubSub('settings', defaultSettings);
```

`createLocalStoragePubSub` registers the localStorage-writing subscriber internally, so components just read and write `settingsPubSub` like any other channel.

### HistoryDrawer (`client/components/Search/History/`)

**Responsibility:** Search history display and management

**PubSub:**
- **Subscribes:** History loaded from IndexedDB (not via PubSub, via custom hook)

**Hook:** `useSearchHistory()`
```typescript
const {
  filteredSearches,
  groupedSearches,
  togglePin,
  deleteEntry,
  searchHistory,
} = useSearchHistory({ limit: 100, enableGrouping: true });
```

Restoring a past search (re-running its query) is handled separately by `useHistoryRestore`, used in `SearchForm`:
```typescript
const { restoreSearch } = useHistoryRestore(updateQuery, textAreaRef);
```

**Features:**
- Fuzzy search through history
- Date-based grouping (Today, Yesterday, Last Week, etc.)
- Pin/unpin searches
- Restore previous search (re-runs query)
- Analytics: Search frequency, cache hit rate

## State Flow Examples

### Search Flow

```
User types query
    ↓
SearchForm updates queryPubSub
    ↓
User submits
    ↓
searchAndRespond() called
    ↓
searchText() updates textSearchStatePubSub → 'loading'
    ↓
SearchResultsSection shows loading skeleton
    ↓
API returns results
    ↓
textSearchResultsPubSub updated with results
    ↓
textSearchStatePubSub → 'idle'
    ↓
SearchResultsSection renders results
```

### AI Response Flow

```
Search results ready
    ↓
canStartResponding() → true
    ↓
textGenerationStatePubSub → 'loadingModel'
    ↓
AiResponseSection shows "Loading AI model..."
    ↓
Model loaded
    ↓
textGenerationStatePubSub → 'generating'
    ↓
Response tokens stream in
    ↓
responsePubSub updated (throttled 12/sec)
    ↓
AiResponseSection updates content
    ↓
Generation complete
    ↓
textGenerationStatePubSub → 'completed'
```

### Chat Flow

```
User sends message
    ↓
Message added to chatMessagesPubSub
    ↓
generateChatResponse() called
    ↓
Token budget calculated
    ↓
If overflow: generate summary → conversationSummaryPubSub
    ↓
Inference API called
    ↓
Response tokens stream to responsePubSub
    ↓
Full response added to chatMessagesPubSub
    ↓
Saved to IndexedDB
```

## Custom Hooks

### usePubSub

Subscribes to a PubSub channel:
```typescript
const [value, setValue] = usePubSub(channel);
```

### useSearchHistory

Manages search history from IndexedDB:
```typescript
const { searchHistory, groupedSearches, deleteEntry, togglePin } = useSearchHistory();
```

### useDrawerState

Manages open/close state for a drawer with log entry tracking:
```typescript
const { isDrawerOpen, openDrawer, closeDrawer } = useDrawerState(
  "User opened the menu",
  "User closed the menu",
);
```

## Styling

**Framework:** Mantine UI v9

**Theme Configuration:**
```typescript
// client/components/App/App.tsx
<MantineProvider defaultColorScheme="dark">
```

**Dark Mode:**
- Default color scheme is dark
- All components support dark mode via Mantine

## Accessibility

**Standards:** WCAG 2.1 AA compliance

**Features:**
- All interactive elements keyboard accessible
- ARIA labels on select interactive elements (e.g. chat input, message list, history actions, logs modal)
- Focus management in drawers and modals
- Screen reader announcements for loading states

**Implementation:**
```typescript
// Using Mantine's accessibility props
<Button aria-label="Search the web">
  <SearchIcon />
</Button>

<TextInput
  label="Search query"
  aria-describedby="search-help"
/>
<span id="search-help">Enter keywords to search</span>
```

## Component Design Principles

1. **Single Responsibility:** Components do one thing well
2. **PubSub-First:** Use channels for cross-component communication
3. **Lazy Loading:** Route-level components use `React.lazy()` for code splitting
4. **Error Boundaries:** Used selectively -- `SearchResultsSection` wraps each result type, and `MarkdownRenderer` wraps syntax-highlighted code blocks (falling back to plain text on failure). AI response and chat components are not currently wrapped in error boundaries.

## File Organization

Most components are single `.tsx` files directly under their feature directory (e.g. `client/components/AiResponse/ChatInterface.tsx`). There is no `index.tsx` re-export convention. CSS Modules are used only where needed (currently just `ImageResultsList.module.css`). Tests, when present, are co-located as `ComponentName.test.tsx` alongside the component, but not every component has one.

## Related Topics

- **Search Module**: `docs/search-history.md` - History implementation
- **AI Integration**: `docs/ai-integration.md` - Text generation flow
- **State Management**: `docs/overview.md` - PubSub architecture
- **Design**: `docs/design.md` - UI/UX principles
