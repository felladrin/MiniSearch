FROM node:lts AS llama-builder

ARG LLAMA_CPP_RELEASE_TAG="b6604"

RUN apt-get update && apt-get install -y \
  build-essential \
  cmake \
  ccache \
  git \
  curl

RUN cd /tmp && \
  git clone https://github.com/ggerganov/llama.cpp.git && \
  cd llama.cpp && \
  git checkout $LLAMA_CPP_RELEASE_TAG && \
  cmake -B build -DGGML_NATIVE=OFF -DLLAMA_CURL=OFF && \
  cmake --build build --config Release -j --target llama-server && \
  mkdir -p /usr/local/lib/llama && \
  find build -type f \( -name "libllama.so" -o -name "libmtmd.so" -o -name "libggml.so" -o -name "libggml-base.so" -o -name "libggml-cpu.so" \) -exec cp {} /usr/local/lib/llama/ \;

FROM node:lts

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
  chown -R ${USERNAME}:${USERNAME} /usr/local/searxng/searxng-src

ARG SEARXNG_SETTINGS_PATH="/etc/searxng/settings.yml"

WORKDIR /usr/local/searxng/searxng-src
RUN cp searx/settings.yml $SEARXNG_SETTINGS_PATH && \
  chown ${USERNAME}:${USERNAME} $SEARXNG_SETTINGS_PATH && \
  chmod 644 $SEARXNG_SETTINGS_PATH && \
  sed -i 's/ultrasecretkey/'$(openssl rand -hex 32)'/g' $SEARXNG_SETTINGS_PATH && \
  sed -i 's/- html/- json/' $SEARXNG_SETTINGS_PATH && \
  /usr/local/searxng/searxng-venv/bin/pip install -r requirements.txt && \
  /usr/local/searxng/searxng-venv/bin/pip install -e .

COPY --from=llama-builder /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/
COPY --from=llama-builder /usr/local/lib/llama/* /usr/local/lib/
RUN ldconfig /usr/local/lib

USER ${USERNAME}

WORKDIR ${APP_DIR}

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

COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package-lock.json ./.npmrc ./

RUN npm ci

COPY --chown=${USERNAME}:${USERNAME} . .

RUN git config --global --add safe.directory ${APP_DIR} && \
  npm run build

HEALTHCHECK --interval=5m CMD curl -f http://localhost:7860/status || exit 1

ENTRYPOINT [ "/bin/sh", "-c" ]

CMD ["(cd /usr/local/searxng/searxng-src && /usr/local/searxng/searxng-venv/bin/python -m searx.webapp > /dev/null 2>&1) & (npx pm2 start ecosystem.config.cjs && npx pm2 logs)" ]
