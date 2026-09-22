FROM node:lts-slim

# Renovate keeps this pin current via the customManager in renovate.json,
# whose regex matches this exact line: keep the quoted 40-character form.
ARG SEARXNG_COMMIT_SHA="2e624bed40eb97b46faa98094a0b74d3ececd93d"

ENV PORT=7860
EXPOSE $PORT

ARG USERNAME=node
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app

# The slim base ships `npm`'s dependency tree at stale releases, and npm
# pins that tree exactly, so neither `npm install -g npm@latest` nor a
# clean-prefix install lifts the bundled copies off flagged versions.
# The patched releases are installed into a scratch project here, and
# scripts/npm-bundle-overlay.cjs copies them over every stale copy under
# /usr/local/lib/node_modules after verifying every declaration in the
# tree accepts them; it then re-walks the tree and fails the build if any
# flagged version survives. The scratch install is outside the app lockfile,
# so these pins are the only place the versions live. npm itself is pinned:
# an unpinned `npm@latest` would let an upstream release break this build
# at any moment.
COPY scripts/npm-bundle-overlay.cjs /tmp/npm-bundle-overlay.cjs

RUN npm install --global npm@12.0.2 && \
  mkdir -p /tmp/overlay && \
  printf '{"name":"overlay","private":true}' > /tmp/overlay/package.json && \
  npm install --prefix /tmp/overlay --no-audit --no-fund --ignore-scripts \
    tar@7.5.22 \
    brace-expansion@5.0.12 \
    ip-address@10.7.2 \
    undici@6.28.1 && \
  node /tmp/npm-bundle-overlay.cjs && \
  node -e "const r=require, p='/usr/local/lib/node_modules/npm/node_modules/'; for (const m of ['tar','brace-expansion','ip-address','undici']) r(p+m); console.log('overlay require smoke ok')" && \
  npm cache clean --force && \
  rm -rf /root/.npm /tmp/overlay /tmp/npm-bundle-overlay.cjs

# The slim base omits tools the full `node` image ships implicitly: `git` for
# the SearXNG checkout and the build's commit hash, `curl` for the HEALTHCHECK
# below, `openssl` for the SearXNG secret key, and `ca-certificates` for both
# the clone and pip. `apt-get upgrade` pulls the patched Debian releases of
# libraries the base pins (libpcre2, liblzma5, ...).
RUN apt-get update && \
  apt-get upgrade -y && \
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
  /usr/local/searxng/searxng-venv/bin/pip install --no-build-isolation -e . && \
  /usr/local/searxng/searxng-venv/bin/pip uninstall -y wheel setuptools && \
  /usr/local/searxng/searxng-venv/bin/pip uninstall -y pip && \
  /usr/local/searxng/searxng-venv/bin/python -c "import searx.webapp" && \
  rm -f /tmp/sxng_cache_*

# The runtime never pip-installs, and pip itself vendors flagged copies of
# msgpack and setuptools (`pip/_vendor/vendor.txt`) that no released pip
# has bumped, so the pip tree is removed from the shipped venv. SearXNG
# needs neither pip nor setuptools at runtime: a grep of `searx/` for
# `pkg_resources`/`import pip` at the pinned commit comes up empty, and
# the `import searx.webapp` build check above proves the package imports
# after the removal. The editable install finder is plain importlib.

# That same import also creates SearXNG's SQLite caches in the temp directory,
# owned by root because the build runs as root. The container runs as `node`,
# and SearXNG wipes and rebuilds those caches whenever `server.secret_key`
# differs from the one written above, so shipping them makes an instance with
# its own key die at startup with `attempt to write a readonly database`, with
# no search and a container that still reports healthy (#2732). Clearing them
# lets the running user create its own on first start; the `-shm` and `-wal`
# sidecars go with them, or SQLite fails on those instead.

# Create the app directory while still root and hand it to the app user:
# the legacy (non-BuildKit) builder creates WORKDIR directories as root even
# under USER, which then breaks `npm ci`'s mkdir of node_modules.
RUN mkdir -p ${APP_DIR} && chown ${USERNAME}:${USERNAME} ${APP_DIR}

USER ${USERNAME}

WORKDIR ${APP_DIR}

COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package-lock.json ./.npmrc ./

RUN npm ci

COPY --chown=${USERNAME}:${USERNAME} . .

# The commit hash is optional build metadata, so a build context without a
# usable repository must not fail the build. This happens when building from a
# git worktree, where `.git` is a file pointing at a gitdir outside the context;
# git then treats every command as fatal, including `config --global`.
# Dev-only packages (the native TypeScript compiler, Playwright, Vitest, ...)
# are build-time tools the running server never loads; pruning them keeps
# advisory surface out of the shipped image. `vite` and the plugins it loads
# at preview time stay because `npm start` runs `vite preview` and the server
# hooks load with the config.
RUN git config --global --add safe.directory ${APP_DIR} 2>/dev/null || true; \
  git rev-parse --short HEAD >/dev/null 2>&1 || \
  echo "WARNING: no usable git repository in the build context, so the app will report an empty commit hash."; \
  npm run build && \
  npm prune --omit=dev

HEALTHCHECK --start-period=60s --interval=30s --timeout=10s --retries=3 CMD curl -fsS http://localhost:${PORT}/status || exit 1

ENTRYPOINT [ "/bin/sh", "-c" ]

CMD ["(cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp > /dev/null 2>&1) & npm start -- --host"]
