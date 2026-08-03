FROM node:lts-slim

ARG SEARXNG_COMMIT_SHA="6da6eee265daeb4a62ab638d6921522bf405de69"

ENV PORT=7860
EXPOSE $PORT

ARG USERNAME=node
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app

# The slim base omits tools the full `node` image ships implicitly: `git` for
# the SearXNG checkout and the build's commit hash, `curl` for the HEALTHCHECK
# below, `openssl` for the SearXNG secret key, and `ca-certificates` for both
# the clone and pip.
RUN apt-get update && \
  apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  openssl \
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

COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package-lock.json ./.npmrc ./

RUN npm ci

COPY --chown=${USERNAME}:${USERNAME} . .

# The commit hash is optional build metadata, so a build context without a
# usable repository must not fail the build. This happens when building from a
# git worktree, where `.git` is a file pointing at a gitdir outside the context;
# git then treats every command as fatal, including `config --global`.
RUN git config --global --add safe.directory ${APP_DIR} 2>/dev/null || true; \
  git rev-parse --short HEAD >/dev/null 2>&1 || \
  echo "WARNING: no usable git repository in the build context, so the app will report an empty commit hash."; \
  npm run build

HEALTHCHECK --start-period=60s --interval=30s --timeout=10s --retries=3 CMD curl -fsS http://localhost:${PORT}/status || exit 1

ENTRYPOINT [ "/bin/sh", "-c" ]

CMD ["(cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp > /dev/null 2>&1) & npm start -- --host"]
