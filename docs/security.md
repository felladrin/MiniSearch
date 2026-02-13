# Security

## Access Control

- **Optional Access Keys**: `ACCESS_KEYS` environment variable for usage restriction
- **Rate Limiting**: Applied to search and inference endpoints
- **Server-side Validation**: Access keys verified before proxying to SearXNG
- **Key Timeout**: `ACCESS_KEY_TIMEOUT_HOURS` controls cache duration

## Privacy

- **Local-First Storage**: All data stored in IndexedDB, no cloud sync
- **No Tracking**: No telemetry, analytics, or user tracking
- **SearXNG Integration**: All web searches routed through privacy-focused metasearch
- **No External Requests**: Optional browser-only mode for complete privacy

## Data Protection

- **Encrypted Storage**: Optional encryption for sensitive data
- **TTL-based Cleanup**: Automatic cleanup of cached data
- **No PII Collection**: No personally identifiable information stored
- **User Control**: Users can export and delete all their data

## Security Best Practices

- Input validation on all endpoints
- Sanitization of user-generated content
- Secure random token generation
- HTTPS enforcement in production
- Regular dependency updates via Renovate
- **Argon2 Hashing**: Access keys hashed using argon2id for secure storage
- **Cross-Origin Isolation**: COOP/COEP headers for SharedArrayBuffer security

## Threat Model

- **Local Environment**: Assumes trusted local execution
- **Network Requests**: All external requests go through SearXNG proxy
- **AI Models**: Models run locally or through trusted providers
- **Data Exfiltration**: Prevented by local-first architecture

## Related Topics

- **Configuration**: `docs/configuration.md` - Environment variables for access control
- **Overview**: `docs/overview.md` - Security architecture and data flow
- **AI Integration**: `docs/ai-integration.md` - Privacy implications of inference types
