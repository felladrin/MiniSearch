<div align="center">
  <a href="https://felladrin-minisearch.hf.space">
    <img src="client/public/favicon.png" alt="MiniSearch logo" width="76" height="76" />
  </a>
  <h1>MiniSearch</h1>
  <p><strong>Private AI search that runs in your browser.</strong></p>
  <p>
    <a href="https://felladrin-minisearch.hf.space"><img alt="Live Demo" src="https://img.shields.io/badge/Live_Demo-Hugging_Face-FFD21E?logo=huggingface" /></a>
    <a href="https://github.com/felladrin/MiniSearch/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/felladrin/MiniSearch/actions/workflows/ci.yml/badge.svg" /></a>
    <a href="https://github.com/felladrin/MiniSearch/pkgs/container/minisearch"><img alt="Docker image" src="https://img.shields.io/badge/ghcr.io-felladrin%2Fminisearch-2496ED?logo=docker&logoColor=white" /></a>
    <a href="license.txt"><img alt="License" src="https://img.shields.io/github/license/felladrin/MiniSearch" /></a>
    <a href="https://github.com/felladrin/MiniSearch/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/felladrin/MiniSearch?style=flat&logo=github" /></a>
  </p>
  <img src="https://github.com/user-attachments/assets/f8d72a8e-a725-42e9-9358-e6ebade2acb2" alt="MiniSearch answering a query: an AI response with citations above the search results" width="720" />
</div>

## About

MiniSearch is a self-hosted search engine with an AI assistant.

The AI can run entirely inside your browser tab, on GPU or CPU, so a working setup needs no API key, no separate inference server, and no third party seeing your queries. Web results come from a bundled [SearXNG](https://github.com/searxng/searxng) metasearch instance, are reranked locally, and the whole thing ships as a single Docker container.

## Features

- **Private by design.** No tracking, no telemetry, no accounts. Search history, cached results, and chats are stored in your browser and never leave your machine.
- **AI in your browser.** Pick from several curated models (135M to 4B parameters) that run on WebGPU where available and on CPU elsewhere. Models are downloaded once and cached by the browser.
- **Any backend you like.** Connect an OpenAI-compatible API (Ollama, LM Studio, vLLM, llama.cpp server, or a hosted provider), use the crowdsourced AI Horde, or let the server proxy your own API without exposing its key.
- **A real search pipeline.** Text and image results aggregated by SearXNG, reranked locally by a cross-encoder model, cached, and rate-limited; all inside the container.
- **Answers you can verify.** Responses cite the sources they draw from, support follow-up questions with conversation memory, reveal the model's reasoning on demand, and can be read aloud. Turn on *Read Page Content* and the answer is grounded on the text of the top results, not only on their search snippets.
- **Local history and analytics.** Fuzzy-searchable history with pinning and full-session restore, plus usage statistics and an activity heatmap. Retention is configurable, and storage stays in the browser.
- **Fits your workflow.** Set it as your browser's default search engine, trigger it from Raycast, embed it in your own pages, and optionally protect your instance with access keys.

## Quick start

Run the published image:

```bash
docker run -p 7860:7860 ghcr.io/felladrin/minisearch
```

Then open <http://localhost:7860> and start searching.

<details>
<summary>Pin to a specific build</summary>

`latest` moves on every release, so it changes under you. To stay on a known-good build, pin the digest, which always identifies the same image:

```bash
docker inspect --format '{{index .RepoDigests 0}}' ghcr.io/felladrin/minisearch:latest
docker run -p 7860:7860 ghcr.io/felladrin/minisearch@sha256:1a2b3c...
```

The version the running instance reports (in the menu, and under `build` on `/status`) tells you which commit it was built from.

Images carry provenance and SBOM attestations, which you can inspect with:

```bash
docker buildx imagetools inspect ghcr.io/felladrin/minisearch:latest
```

</details>

<details>
<summary>Use Docker Compose</summary>

Add the service to your `docker-compose.yml`:

```yaml
services:
  minisearch:
    image: ghcr.io/felladrin/minisearch:latest
    ports:
      - "7860:7860"
```

</details>

<details>
<summary>Build from source</summary>

```bash
git clone https://github.com/felladrin/MiniSearch.git
cd MiniSearch
docker compose -f docker-compose.production.yml up --build
```

</details>

<details>
<summary>Host it on Hugging Face</summary>

[Duplicate the Space](https://huggingface.co/spaces/Felladrin/MiniSearch?duplicate=true) to get your own hosted instance, no server required. Environment variables can be set in the Space settings.

</details>

## How it works

```mermaid
flowchart LR
    subgraph browser [Your browser]
        UI[Search UI]
        LocalAI[In-browser model<br/>WebGPU or CPU]
        Storage[(IndexedDB<br/>history and cache)]
    end
    subgraph container [Docker container]
        Server[App server]
        SearXNG[SearXNG<br/>metasearch]
        Reranker[Reranker<br/>ONNX Runtime]
    end
    UI <--> Storage
    UI -->|search| Server
    Server --> SearXNG
    SearXNG --> Web((Web))
    Server --> Reranker
    UI -.->|in-browser inference| LocalAI
    UI -.->|remote inference, optional| RemoteAPI[OpenAI-compatible API<br/>or AI Horde]
```

Your query goes to the app server, which asks the bundled SearXNG instance to aggregate results from multiple search engines. The server reranks them with a small cross-encoder model before returning them, and the browser caches them locally. If the AI response is enabled, the assistant reads the top results and writes a cited answer, either with a model running in your browser or through the backend you configured. The full picture is in [docs/overview.md](docs/overview.md).

## Configuration

MiniSearch works out-of-the-box, but you can customize it if you want. More details at [docs/configuration.md](docs/configuration.md).

## FAQ

<details>
<summary>How do I make it my browser's default search engine?</summary>

Add a custom search engine in your browser settings using the pattern `http://localhost:7860/?q=%s`, replacing the host with your instance's address. Your search term replaces `%s`.

</details>

<details>
<summary>How do I search from Raycast?</summary>

Add [this Quicklink](https://ray.so/quicklinks/shared?quicklinks=%7B%22link%22:%22https:%5C/%5C/felladrin-minisearch.hf.space%5C/?q%3D%7BQuery%7D%22,%22name%22:%22MiniSearch%22%7D) to Raycast, and edit it to point to your own instance if you have one.

</details>

<details>
<summary>Can I use my own models through an OpenAI-compatible API?</summary>

Yes. Open the menu, set "AI Processing Location" to `Remote server (OpenAI-compatible API)`, then fill in the base URL, and optionally an API key and a model name. If the model is left blank, it is picked from the ones the API lists.

</details>

<details>
<summary>Can others use my instance with my API key without seeing it?</summary>

Yes. Configure the `INTERNAL_OPENAI_COMPATIBLE_API_*` variables from the [Configuration](#configuration) table and restart the container. A new option with the name you chose appears in the "AI Processing Location" menu, and the key stays on the server.

</details>

## Contributing

See the [Contributing Guidelines](.github/CONTRIBUTING.md), [Code of Conduct](.github/CODE_OF_CONDUCT.md), and [Security Policy](.github/SECURITY.md).

## License

[Apache License 2.0](license.txt)
