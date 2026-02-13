# Quick Start

## Prerequisites

- Docker Desktop or Docker Engine
- Node.js 22+ (for local development only)
- Git

## Installation & Running

### Development (Recommended for Contributing)

```bash
# Clone the repository
git clone https://github.com/felladrin/MiniSearch.git
cd MiniSearch

# Start all services (SearXNG, llama-server, Node.js app)
docker compose up
```

Access the application at `http://localhost:7861`

The development server includes:
- Hot Module Replacement (HMR) for instant code changes
- Full dev tools and source maps
- Live code watching with volume mounts

### Production

```bash
# Build and start production containers
docker compose -f docker-compose.production.yml up --build
```

Access at `http://localhost:7860`

Production mode:
- Pre-built optimized assets
- No dev tools or HMR
- Optimized Docker layer caching

## First Configuration

### No Configuration Required (Default)

MiniSearch works out of the box with browser-based AI inference. Search works immediately, and AI responses use on-device models via WebLLM (WebGPU).

### Optional: Enable AI Response

1. Open the application
2. Click **Settings** (gear icon)
3. Toggle **Enable AI Response**
4. The app will download ~300MB-1GB model files on first use
5. Subsequent loads are instant (cached in IndexedDB)

### Optional: Restrict Access

Add access keys to prevent unauthorized usage:

```bash
# Create .env file
echo 'ACCESS_KEYS="my-secret-key-1,my-secret-key-2"' > .env

# Restart containers
docker compose up --build
```

Users will be prompted to enter an access key before using the app.

## Development Without Docker

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# In another terminal, start SearXNG (or use standalone instance)
# See SearXNG documentation for setup
```

Access at `http://localhost:7860`

## Verification

### Test Search
1. Enter any query in the search box
2. Press Enter or click Search
3. Results should appear within 2-5 seconds

### Test AI Response
1. Toggle "Enable AI Response" in Settings
2. Search for "What is quantum computing?"
3. After search results load, an AI-generated response should appear with citations

### Test Chat
1. After getting an AI response
2. Type a follow-up question like "Tell me more"
3. The AI should respond using conversation context

## Common Issues

### Issue: Search returns no results
**Solution**: Verify SearXNG is running. Check container logs:
```bash
docker compose logs searxng
```

### Issue: AI response never loads
**Solution**: Check browser console for errors. Common causes:
- WebGPU not supported (use Wllama inference instead)
- Model download blocked by firewall
- Insufficient disk space for model caching

### Issue: Access key not working
**Solution**: Ensure `ACCESS_KEYS` is set in `.env` file and containers were rebuilt with `--build` flag.

### Issue: Port already in use
**Solution**: Change ports in `docker-compose.yml`:
```yaml
ports:
  - "7862:7860"  # Use 7862 instead of 7861
```

## Next Steps

- **Customize AI**: See `docs/ai-integration.md` for model selection and inference options
- **Configure**: See `docs/configuration.md` for all environment variables and settings
- **Architecture**: See `docs/overview.md` for system design
- **Contributing**: See `docs/pull-requests.md` for development workflow
