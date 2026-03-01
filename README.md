# MiniSearch

A minimalist web-searching app with an AI assistant that runs directly from your browser.

Live demo: https://felladrin-minisearch.hf.space

## Screenshot

![MiniSearch Screenshot](https://github.com/user-attachments/assets/f8d72a8e-a725-42e9-9358-e6ebade2acb2)

## Features

- **Privacy-focused**: [No tracking, no ads, no data collection](https://docs.searxng.org/own-instance.html#how-does-searxng-protect-privacy)
- **Easy to use**: Minimalist yet intuitive interface for all users
- **Cross-platform**: Models run inside the browser, both on desktop and mobile
- **Integrated**: Search from the browser address bar by setting it as the default search engine
- **Efficient**: Models are loaded and cached only when needed
- **Customizable**: Tweakable settings for search results and text generation
- **Open-source**: [The code is available for inspection and contribution at GitHub](https://github.com/felladrin/MiniSearch)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

## Getting started

Here are the easiest ways to get started with MiniSearch. Pick the one that suits you best.

**Option 1** - Use [MiniSearch's Docker Image](https://github.com/felladrin/MiniSearch/pkgs/container/minisearch) by running in your terminal:

```bash
docker run -p 7860:7860 ghcr.io/felladrin/minisearch:main
```

**Option 2** - Add MiniSearch's Docker Image to your existing Docker Compose file:

```yaml
services:
  minisearch:
    image: ghcr.io/felladrin/minisearch:main
    ports:
      - "7860:7860"
```

**Option 3** - Build from source by [downloading the repository files](https://github.com/felladrin/MiniSearch/archive/refs/heads/main.zip) and running:

```bash
docker compose -f docker-compose.production.yml up --build
```

Once the container is running, open http://localhost:7860 in your browser and start searching!

## Frequently asked questions [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/felladrin/MiniSearch)

<details>
  <summary>How do I search via the browser's address bar?</summary>
  <p>
    You can set MiniSearch as your browser's address-bar search engine using the pattern <code>http://localhost:7860/?q=%s</code>, in which your search term replaces <code>%s</code>.
  </p>
</details>

<details>
  <summary>How do I search via Raycast?</summary>
  <p>
    You can add <a href="https://ray.so/quicklinks/shared?quicklinks=%7B%22link%22:%22https:%5C/%5C/felladrin-minisearch.hf.space%5C/?q%3D%7BQuery%7D%22,%22name%22:%22MiniSearch%22%7D" target="_blank">this Quicklink</a> to Raycast, so typing your query will open MiniSearch with the search results. You can also edit it to point to your own domain.
  </p>
  <img width="744" alt="image" src="https://github.com/user-attachments/assets/521dca22-c77b-42de-8cc8-9feb06f9a97e">
</details>

<details>
  <summary>Can I use custom models via OpenAI-Compatible API?</summary>
  <p>
    Yes! For this, open the Menu and change the "AI Processing Location" to <code>Remote server (API)</code>. Then configure the Base URL, and optionally set an API Key and a Model to use.
  </p>
</details>

<details>
  <summary>How do I restrict the access to my MiniSearch instance via password?</summary>
  <p>
    Create a <code>.env</code> file and set a value for <code>ACCESS_KEYS</code>. Then reset the MiniSearch docker container.
  </p>
  <p>
    For example, if you to set the password to <code>PepperoniPizza</code>, then this is what you should add to your <code>.env</code>:<br/>
    <code>ACCESS_KEYS="PepperoniPizza"</code>
  </p>
  <p>
    You can find more examples in the <code>.env.example</code> file.
  </p>
</details>

<details>
  <summary>I want to serve MiniSearch to other users, allowing them to use my own OpenAI-Compatible API key, but without revealing it to them. Is it possible?</summary>
  <p>Yes! In MiniSearch, we call this text-generation feature "Internal OpenAI-Compatible API". To use this it:</p>
  <ol>
    <li>Set up your OpenAI-Compatible API endpoint by configuring the following environment variables in your <code>.env</code> file:
      <ul>
        <li><code>INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL</code>: The base URL for your API</li>
        <li><code>INTERNAL_OPENAI_COMPATIBLE_API_KEY</code>: Your API access key</li>
        <li><code>INTERNAL_OPENAI_COMPATIBLE_API_MODEL</code>: The model to use</li>
        <li><code>INTERNAL_OPENAI_COMPATIBLE_API_NAME</code>: The name to display in the UI</li>
      </ul>
    </li>
    <li>Restart MiniSearch server.</li>
    <li>In the MiniSearch menu, select the new option (named as per your <code>INTERNAL_OPENAI_COMPATIBLE_API_NAME</code> setting) from the "AI Processing Location" dropdown.</li>
  </ol>
</details>

<details>
  <summary>How can I contribute to the development of this tool?</summary>
  <p>We welcome contributions! Please read our <a href=".github/CONTRIBUTING.md">Contributing Guidelines</a> for detailed information on how to get started.</p>
  <p>Quick start:</p>
  <ol>
    <li>Fork this repository and clone it</li>
    <li>Start the development server: <code>docker compose up</code></li>
    <li>Make your changes and test them</li>
    <li>Push to your fork and open a pull request</li>
  </ol>
  <p>All contributions are welcome! 🎉</p>
</details>

<details>
  <summary>Where can I find more information?</summary>
  <ul>
    <li><a href=".github/CONTRIBUTING.md">Contributing Guidelines</a> - How to contribute to MiniSearch</li>
    <li><a href=".github/CODE_OF_CONDUCT.md">Code of Conduct</a> - Our community guidelines</li>
    <li><a href=".github/SECURITY.md">Security Policy</a> - How to report security vulnerabilities</li>
    <li><a href="docs/">Documentation</a> - Detailed project documentation</li>
  </ul>
</details>
