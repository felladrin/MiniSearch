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
- **Time-saver**: AI responses enhanced with search results
- **Efficient**: Models are loaded and cached only when needed
- **Open-source**: [The code is available for inspection and contribution at GitHub](https://github.com/felladrin/MiniSearch)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

## Getting started

There are two ways to get started with MiniSearch. Pick one that suits you best.

**Option 1** - Use [MiniSearch's Docker Image](https://github.com/felladrin/MiniSearch/pkgs/container/minisearch) by running:

```bash
docker run -p 7860:7860 ghcr.io/felladrin/minisearch:main
```

**Option 2** - Build from source by cloning this repository and running:

```bash
docker compose -f docker-compose.production.yml up --build
```

Then, open http://localhost:7860 in your browser and start searching!

## Frequently asked questions

<details>
  <summary>How can I contribute to MiniSearch?</summary>
  <p>Fork this repository and clone it. Then, start the development server by running the following command:</p>
  <p><code>docker compose up</code></p>
  <p>Make your changes, push them to your fork, and open a pull request! All contributions are welcome!</p>
</details>

<details>
  <summary>How do I search via the browser's address bar?</summary>
  <p>
    You can set MiniSearch as your browser's address-bar search engine using the pattern <code>http://localhost:7860/?q=%s</code>, in which your search term replaces <code>%s</code>.
  </p>
</details>

<details>
  <summary>Why is MiniSearch built upon SearXNG's Docker Image and using a single image instead of composing it from multiple services?</summary>
  <p>There are a few reasons for this:</p>
  <ul>
    <li>MiniSearch utilizes SearXNG as its meta-search engine.</li>
    <li>Manual installation of SearXNG is not trivial, so we use the docker image they provide, which has everything set up.</li>
    <li>SearXNG only provides a Docker Image based on Alpine Linux.</li>
    <li>The user of the image needs to be customized in a specific way to run on HuggingFace Spaces, where MiniSearch's demo runs.</li>
    <li>HuggingFace only accepts a single docker image. It doesn’t run docker compose or multiple images, unfortunately.</li>
  </ul>
</details>
