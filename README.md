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
  <summary>How do I search via the browser's address bar?</summary>
  <p>
    You can set MiniSearch as your browser's address-bar search engine using the pattern <code>http://localhost:7860/?q=%s</code>, in which your search term replaces <code>%s</code>.
  </p>
</details>

<details>
  <summary>Can I use custom models via OpenAI-Compatible API?</summary>
  <p>
    Yes! For this, open the Menu and change the "Inference Type" to <code>OpenAI-Compatible API</code>. Then configure the Base URL, and optionally set an API Key and a Model to use.
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
    <li>In the MiniSearch menu, select the new option (named as per your <code>INTERNAL_OPENAI_COMPATIBLE_API_NAME</code> setting) from the inference type dropdown.</li>
  </ol>
</details>

<details>
  <summary>How can I contribute to the development of this tool?</summary>
  <p>Fork this repository and clone it. Then, start the development server by running the following command:</p>
  <p><code>docker compose up</code></p>
  <p>Make your changes, push them to your fork, and open a pull request! All contributions are welcome!</p>
</details>

<details>
  <summary>Why is MiniSearch built upon SearXNG's Docker Image and using a single image instead of composing it from multiple services?</summary>
  <p>There are a few reasons for this:</p>
  <ul>
    <li>MiniSearch utilizes SearXNG as its meta-search engine.</li>
    <li>Manual installation of SearXNG is not trivial, so we use the docker image they provide, which has everything set up.</li>
    <li>SearXNG only provides a Docker Image based on Alpine Linux.</li>
    <li>The user of the image needs to be customized in a specific way to run on HuggingFace Spaces, where MiniSearch's demo runs.</li>
    <li>HuggingFace only accepts a single docker image. It doesn't run docker compose or multiple images, unfortunately.</li>
  </ul>
</details>
