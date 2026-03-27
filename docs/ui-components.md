# UI Components

## Architecture Overview

MiniSearch uses a **PubSub-based reactive architecture**. Components subscribe to state changes via channels rather than props drilling or Context API.

### PubSub Pattern

```typescript
// Component subscribes to state
const query = usePubSub(queryPubSub);

// Any module can update state
queryPubSub.set('new query');

// All subscribers automatically re-render
```

**Benefits:**
- No prop drilling
- Decoupled components
- Easy to add new subscribers
- Performance: Only subscribers to changed channel re-render

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
| `textSearchStatePubSub` | `SearchState` | Text search loading/error state | SearchResultsSection, LoadingIndicators |
| `imageSearchStatePubSub` | `SearchState` | Image search loading/error state | ImageResultsSection |
| `textGenerationStatePubSub` | `TextGenerationState` | AI generation state | AiResponseSection, StatusIndicators |
| `modelLoadingProgressPubSub` | `number` | Model download progress (0-100) | AiResponseSection |
| `modelSizeInMegabytesPubSub` | `number` | Model size in MB for progress calc | AiResponseSection |
| `chatMessagesPubSub` | `ChatMessage[]` | Chat conversation | ChatSection, ChatInput |
| `chatInputPubSub` | `string` | Current chat input content | ChatInput |
| `chatGenerationStatePubSub` | `{isGeneratingResponse, isGeneratingFollowUpQuestion}` | Chat generation states | ChatSection |
| `conversationSummaryPubSub` | `{id, summary}` | Rolling conversation summary | TextGeneration module |
| `followUpQuestionPubSub` | `string` | Generated follow-up question | AiResponseSection |
| `suppressNextFollowUpPubSub` | `boolean` | Flag to skip next follow-up | FollowUpQuestions module |
| `isRestoringFromHistoryPubSub` | `boolean` | History restoration in progress | SearchForm, components |
| `menuExpandedAccordionsPubSub` | `string[]` | Expanded menu accordion IDs | SettingsDrawer |
| `querySuggestionsPubSub` | `string[]` | Query suggestions history | SearchForm |
| `lastSearchTokenHashPubSub` | `string` | Hash of last search token | Security/validation |
| `logEntriesPubSub` | `LogEntry[]` | Application log entries | LogsModal, ShowLogsButton |

## Component Hierarchy

```
App
├── AccessPage (if access keys enabled)
└── MainPage
    ├── SearchForm
    │   ├── SearchInput
    │   └── SearchButton
    ├── SettingsDrawer
    │   ├── AISettings
    │   ├── SearchSettings
    │   └── HistorySettings
    ├── SearchResultsSection
    │   ├── TextResultsList
    │   │   └── SearchResultCard (×N)
    │   └── ImageResultsGrid
    │       └── ImageResultCard (×N)
    ├── AiResponseSection
    │   ├── ResponseContent
    │   ├── CitationsPanel
    │   └── ChatSection
    │       ├── ChatMessages
    │       └── ChatInput
    ├── HistoryDrawer
    │   ├── HistoryList
    │   ├── SearchStats
    │   └── HistoryActions
    └── AnalyticsPanel
```

## Key Components

### App (`client/components/App/`)

**Responsibility:** Application shell and routing

**Logic:**
```typescript
// App.tsx
const accessKeyValidated = usePubSub(accessKeyValidatedPubSub);

if (!accessKeyValidated) {
  return <AccessPage />;
}

return (
  <MantineProvider>
    <MainPage />
  </MantineProvider>
);
```

**Subscribes to:** `accessKeyValidatedPubSub`

### SearchForm (`client/components/Search/Form/`)

**Responsibility:** Query input and search initiation

**PubSub:**
- **Subscribes:** `queryPubSub`, `textSearchStatePubSub`
- **Updates:** `queryPubSub` (on type), triggers `searchAndRespond()` (on submit)

**Logic:**
```typescript
const SearchForm: React.FC = () => {
  const [query, setQuery] = usePubSub(queryPubSub);
  const searchState = usePubSub(textSearchStatePubSub);
  
  const handleSubmit = () => {
    searchAndRespond();
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button disabled={searchState.loading}>
        {searchState.loading ? 'Searching...' : 'Search'}
      </button>
    </form>
  );
};
```

### SearchResultsSection (`client/components/Search/Results/`)

**Responsibility:** Display search results (text and images)

**PubSub:**
- **Subscribes:** `textSearchResultsPubSub`, `imageSearchResultsPubSub`, `textSearchStatePubSub`

**Logic:**
```typescript
const SearchResultsSection: React.FC = () => {
  const textResults = usePubSub(textSearchResultsPubSub);
  const imageResults = usePubSub(imageSearchResultsPubSub);
  const searchState = usePubSub(textSearchStatePubSub);
  
  if (searchState.loading) return <LoadingSkeleton />;
  if (searchState.error) return <ErrorMessage error={searchState.error} />;
  
  return (
    <>
      <TextResultsList results={textResults} />
      {settings.enableImageSearch && <ImageResultsGrid results={imageResults} />}
    </>
  );
};
```

### AiResponseSection (`client/components/AiResponse/`)

**Responsibility:** AI response display and chat interface

**PubSub:**
- **Subscribes:** `responsePubSub`, `textGenerationStatePubSub`, `chatMessagesPubSub`

**States:**
- `idle`: No response yet
- `loadingModel`: Downloading/loading AI model
- `awaitingSearchResults`: Waiting for search before generating
- `generating`: Streaming response
- `completed`: Full response received
- `failed`: Error occurred

**Logic:**
```typescript
const AiResponseSection: React.FC = () => {
  const response = usePubSub(responsePubSub);
  const state = usePubSub(textGenerationStatePubSub);
  const messages = usePubSub(chatMessagesPubSub);
  
  return (
    <section>
      <ResponseContent content={response} />
      <GenerationStatus state={state} />
      <CitationsPanel results={textResults} />
      <ChatSection messages={messages} />
    </section>
  );
};
```

### SettingsDrawer (`client/components/Pages/Main/Menu/`)

**Responsibility:** Application settings UI

**Sub-components:**
- **AISettings:** Model selection, inference type, temperature
- **SearchSettings:** Result limits, image search toggle
- **HistorySettings:** Retention days, max entries

**PubSub:**
- **Subscribes/Updates:** `settingsPubSub` (full settings object)

**Persistence:**
```typescript
// Settings automatically persisted to localStorage
settingsPubSub.subscribe(newSettings => {
  localStorage.setItem('settings', JSON.stringify(newSettings));
});
```

### HistoryDrawer (`client/components/Search/History/`)

**Responsibility:** Search history display and management

**PubSub:**
- **Subscribes:** History loaded from IndexedDB (not via PubSub, via custom hook)

**Hook:** `useSearchHistory()`
```typescript
const { 
  searches, 
  groupedSearches, 
  deleteSearch, 
  pinSearch, 
  restoreSearch,
  searchHistory 
} = useSearchHistory();
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
const { searches, groupedSearches, deleteSearch, restoreSearch } = useSearchHistory();
```

### useLocalStorage

Syncs state with localStorage:
```typescript
const [value, setValue] = useLocalStorage('key', defaultValue);
```

## Styling

**Framework:** Mantine UI v8

**Theme Configuration:**
```typescript
// client/main.tsx
<MantineProvider
  theme={{
    primaryColor: 'blue',
    defaultRadius: 'md',
    fontFamily: 'system-ui, sans-serif',
  }}
>
```

**Responsive Breakpoints:**
- `xs`: 0-576px
- `sm`: 576-768px
- `md`: 768-992px
- `lg`: 992-1200px
- `xl`: 1200px+

**Dark Mode:**
- Automatic based on system preference
- Toggle available in settings
- All components support dark mode via Mantine

## Accessibility

**Standards:** WCAG 2.1 AA compliance

**Features:**
- All interactive elements keyboard accessible
- ARIA labels on all buttons and inputs
- Focus management in drawers and modals
- Screen reader announcements for loading states
- Reduced motion support

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

1. **Self-Contained:** Each component folder includes component, styles, tests, and types
2. **Single Responsibility:** Components do one thing well
3. **PubSub-First:** Use channels for cross-component communication
4. **Lazy Loading:** Route-level components use `React.lazy()` for code splitting
5. **Error Boundaries:** Each major section wrapped in error boundary

## File Organization

```
client/components/
├── ComponentName/
│   ├── index.tsx          # Main component
│   ├── ComponentName.tsx  # Component implementation
│   ├── ComponentName.module.css  # Scoped styles
│   ├── ComponentName.test.tsx    # Unit tests
│   └── types.ts           # Component-specific types
```

## Related Topics

- **Search Module**: `docs/search-history.md` - History implementation
- **AI Integration**: `docs/ai-integration.md` - Text generation flow
- **State Management**: `docs/overview.md` - PubSub architecture
- **Design**: `docs/design.md` - UI/UX principles
