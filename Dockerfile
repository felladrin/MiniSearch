FROM node:lts

ARG SEARXNG_COMMIT_SHA="6da6eee265daeb4a62ab638d6921522bf405de69"

ENV PORT=7860
EXPOSE $PORT

ARG USERNAME=node
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app

RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  python3 \
  python3-venv && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/local/searxng /etc/searxng && \
  chown -R ${USERNAME}:${USERNAME} /usr/local/searxng /etc/searxng && \
  chmod 755 /etc/searxng

WORKDIR /usr/local/searxng
RUN python3 -m venv searxng-venv && \
  chown -R ${USERNAME}:${USERNAME} /usr/local/searxng/searxng-venv && \
  /usr/local/searxng/searxng-venv/bin/pip install --upgrade pip && \
  /usr/local/searxng/searxng-venv/bin/pip install wheel setuptools pyyaml lxml

RUN git clone https://github.com/searxng/searxng.git /usr/local/searxng/searxng-src && \
  git -C /usr/local/searxng/searxng-src checkout $SEARXNG_COMMIT_SHA && \
  chown -R ${USERNAME}:${USERNAME} /usr/local/searxng/searxng-src

ARG SEARXNG_SETTINGS_PATH="/etc/searxng/settings.yml"

COPY --chown=${USERNAME}:${USERNAME} searxng-settings.yml $SEARXNG_SETTINGS_PATH

WORKDIR /usr/local/searxng/searxng-src
RUN chmod 644 $SEARXNG_SETTINGS_PATH && \
  sed -i 's/ultrasecretkey/'$(openssl rand -hex 32)'/g' $SEARXNG_SETTINGS_PATH && \
  /usr/local/searxng/searxng-venv/bin/pip install -r requirements.txt && \
  /usr/local/searxng/searxng-venv/bin/pip install --no-build-isolation -e .

USER ${USERNAME}

WORKDIR ${APP_DIR}

ARG ACCESS_KEYS
ARG ACCESS_KEY_TIMEOUT_HOURS
ARG WLLAMA_DEFAULT_MODEL_ID
ARG INTERNAL_OPENAI_COMPATIBLE_API_BASE_URL
ARG INTERNAL_OPENAI_COMPATIBLE_API_KEY
ARG INTERNAL_OPENAI_COMPATIBLE_API_MODEL
ARG INTERNAL_OPENAI_COMPATIBLE_API_NAME
ARG DEFAULT_INFERENCE_TYPE
ARG HOST
ARG HMR_PORT
ARG ALLOWED_HOSTS

COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package-lock.json ./.npmrc ./

RUN npm ci

COPY --chown=${USERNAME}:${USERNAME} . .

RUN git config --global --add safe.directory ${APP_DIR} && \
  npm run build

HEALTHCHECK --interval=5m CMD curl -f http://localhost:7860/status || exit 1

ENTRYPOINT [ "/bin/sh", "-c" ]

CMD ["(cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp > /dev/null 2>&1) & npm start -- --host"]
