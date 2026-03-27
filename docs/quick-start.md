# Quick Start

## Prerequisites

- Docker Desktop or Docker Engine
- Node.js LTS (for local development only)
- Git
- Modern browser with WebGPU support (for optimal AI performance)

## Installation & Running

### Development (Recommended for Contributing)

```bash
# Clone the repository
git clone https://github.com/felladrin/MiniSearch.git
cd MiniSearch

# Start all services (SearXNG, Node.js app with HMR)
docker compose up
```

Access the application at `http://localhost:7861` (HMR) or `http://localhost:7860` (main)

The development server includes:
- Hot Module Replacement (HMR) on port 7861 for instant code changes
- Full dev tools and source maps
- Live code watching with volume mounts
- Integrated SearXNG search service
- Biome formatting and linting on save

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
4. Choose inference type:
   - **Browser** (recommended): Uses WebLLM with WebGPU or Wllama for local processing
   - **Internal API**: Configure OpenAI-compatible endpoint
   - **AI Horde**: Pre-configured distributed computing
5. The app will download ~300MB-1GB model files on first use (browser mode)
6. Subsequent loads are instant (cached in IndexedDB)

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

**Note**: Running without Docker requires manual SearXNG setup and environment configuration.

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
- WebGPU not supported (app will automatically fall back to Wllama)
- Model download blocked by firewall or CORS
- Insufficient disk space for model caching
- Browser extensions blocking WebAssembly
- Try switching inference types in Settings

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
