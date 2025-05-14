# Build llama.cpp in a separate stage
FROM python:3.13-slim AS llama-builder

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  cmake \
  ccache \
  git \
  curl \
  && rm -rf /var/lib/apt/lists/*

# Build llama.cpp server and collect libraries
RUN cd /tmp && \
  git clone https://github.com/ggerganov/llama.cpp.git --depth=1 && \
  cd llama.cpp && \
  cmake -B build -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF && \
  cmake --build build --config Release -j --target llama-server && \
  mkdir -p /usr/local/lib/llama && \
  find build -type f \( -name "libllama.so" -o -name "libggml.so" -o -name "libggml-base.so" -o -name "libggml-cpu.so" \) -exec cp {} /usr/local/lib/llama/ \;

# Use the SearXNG image as the base for final image
FROM searxng/searxng:2025.5.13-9006866

# Set the default port to 7860 if not provided
ENV PORT=7860

# Expose the port specified by the PORT environment variable
EXPOSE $PORT

# Install necessary packages using Debian's package manager
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  build-essential \
  curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && npm --version \
  && node --version

# Install latest npm
RUN npm install -g npm@latest

# Copy llama.cpp artifacts from builder
COPY --from=llama-builder /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/
COPY --from=llama-builder /usr/local/lib/llama/* /usr/local/lib/
RUN ldconfig /usr/local/lib

# Modify SearXNG configuration:
# 1. Change output format from HTML to JSON
# 2. Remove user switching in the entrypoint script
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml \
  && sed -i 's/su-exec searxng:searxng //' /usr/local/searxng/container/docker-entrypoint.sh

# Set up user and directory structure
ARG USERNAME=user
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app

# Create a non-root user and set up the application directory
RUN useradd -m -u 1000 ${USERNAME} \
  && mkdir -p ${APP_DIR} \
  && chown -R ${USERNAME}:${USERNAME} ${HOME_DIR}

# Set the SearXNG settings folder path
ARG SEARXNG_SETTINGS_FOLDER=/etc/searxng

# Create the SearXNG settings folder and set permissions
RUN mkdir -p ${SEARXNG_SETTINGS_FOLDER} \
  && chown -R ${USERNAME}:${USERNAME} ${SEARXNG_SETTINGS_FOLDER}

# Switch to the non-root user
USER ${USERNAME}

# Set the working directory to the application directory
WORKDIR ${APP_DIR}

# Define environment variables that can be passed to the container during build.
# This approach allows for dynamic configuration without relying on a `.env` file,
# which might not be suitable for all deployment scenarios.
ARG ACCESS_KEYS
ARG ACCESS_KEY_TIMEOUT_HOURS
ARG WEBLLM_DEFAULT_F16_MODEL_ID
ARG WEBLLM_DEFAULT_F32_MODEL_ID
ARG WLLAMA_DEFAULT_MODEL_ID
ARG INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL
ARG INTERNAL_OPENAI_COMPATIBLE_API_KEY
ARG INTERNAL_OPENAI_COMPATIBLE_API_MODEL
ARG INTERNAL_OPENAI_COMPATIBLE_API_NAME
ARG DEFAULT_INFERENCE_TYPE
ARG HOST
ARG HMR_PORT
ARG ALLOWED_HOSTS

# Copy package.json, package-lock.json, and .npmrc files
COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package.json
COPY --chown=${USERNAME}:${USERNAME} ./package-lock.json ./package-lock.json
COPY --chown=${USERNAME}:${USERNAME} ./.npmrc ./.npmrc

# Install Node.js dependencies
RUN npm ci

# Copy the rest of the application files
COPY --chown=${USERNAME}:${USERNAME} . .

# Configure Git to treat the app directory as safe
RUN git config --global --add safe.directory ${APP_DIR}

# Build the application
RUN npm run build

# Set the entrypoint to use a shell
ENTRYPOINT [ "/bin/sh", "-c" ]

# Run SearXNG in the background and start the Node.js application using PM2
CMD [ "(/usr/local/searxng/container/docker-entrypoint.sh -f > /dev/null 2>&1) & (npx pm2 start ecosystem.config.cjs && npx pm2 logs production-server)" ]
