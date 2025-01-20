# Use the SearXNG image as the base
FROM searxng/searxng:2025.1.20-073d9549a

# Set the default port to 7860 if not provided
ENV PORT=7860

# Expose the port specified by the PORT environment variable
EXPOSE $PORT

# Install necessary packages using Alpine's package manager
RUN apk add --update \
  nodejs \
  npm \
  git \
  build-base \
  cmake \
  ccache

# Set the SearXNG settings folder path
ARG SEARXNG_SETTINGS_FOLDER=/etc/searxng

# Modify SearXNG configuration:
# 1. Change output format from HTML to JSON
# 2. Remove user switching in the entrypoint script
# 3. Create and set permissions for the settings folder
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml \
  && sed -i 's/su-exec searxng:searxng //' /usr/local/searxng/dockerfiles/docker-entrypoint.sh \
  && mkdir -p ${SEARXNG_SETTINGS_FOLDER}  \
  && chmod 777 ${SEARXNG_SETTINGS_FOLDER}

# Set up user and directory structure
ARG USERNAME=user
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app

# Create a non-root user and set up the application directory
RUN adduser -D -u 1000 ${USERNAME} \
  && mkdir -p ${APP_DIR} \
  && chown -R ${USERNAME}:${USERNAME} ${HOME_DIR}

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
CMD [ "(/usr/local/searxng/dockerfiles/docker-entrypoint.sh -f > /dev/null 2>&1) & (npx pm2 start ecosystem.config.cjs && npx pm2 logs production-server)" ]
