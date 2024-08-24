# MiniSearch

A minimalist search engine with integrated browser-based AI.

Live demo: https://felladrin-minisearch.hf.space

## Features

- **Privacy-focused**: [No tracking, no ads, no data collection](https://docs.searxng.org/own-instance.html#how-does-searxng-protect-privacy)
- **Easy to use**: Minimalist yet intuitive interface for all users
- **Cross-platform**: Models run inside the browser, both on desktop and mobile
- **Integrated**: Search from the browser address bar by setting it as the default search engine
- **Time-saver**: AI responses enhanced with search results
- **Efficient**: Models are loaded and cached only when needed
- **Optimized**: Aims for the balance between size and performance
- **Open-source**: [The code is available for inspection and contribution at GitHub](https://github.com/felladrin/MiniSearch)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)

## Getting started

The easiest way to get started is by using [MiniSearch's Docker Image](https://github.com/felladrin/MiniSearch/pkgs/container/minisearch) by running the following command:

```bash
docker run -p 7860:7860 ghcr.io/felladrin/minisearch:main
```

Then, open http://localhost:7860 in your browser and start searching!

## Building and running from source

You can build and run it from the source if you don't want to use MiniSearch's Docker Image. For that, clone this repository and run the following command:

```bash
docker compose -f docker-compose.production.yml up --build
```

## Searching via browser's address bar

You can set MiniSearch as your browser's address-bar search engine using the pattern `http://localhost:7860/?q=%s`, in which your search term replaces `%s`.

## Contributing

MiniSearch is open-source and contributions are welcome!

Fork this repository and clone it. Then, start the development server by running the following command:

```bash
docker compose up
```

Make your changes, push them to your fork, and open a pull request!
