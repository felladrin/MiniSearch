FROM searxng/searxng:2024.8.16-29056b9dd
ENV PORT ${PORT:-7860}
EXPOSE ${PORT}
RUN apk add --update \
  nodejs \
  npm \
  git \
  build-base \
  cmake \
  ccache
ARG SEARXNG_SETTINGS_FOLDER=/etc/searxng
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml \
  && sed -i 's/su-exec searxng:searxng //' /usr/local/searxng/dockerfiles/docker-entrypoint.sh \
  && mkdir -p ${SEARXNG_SETTINGS_FOLDER}  \
  && chmod 777 ${SEARXNG_SETTINGS_FOLDER}
ARG USERNAME=user
ARG HOME_DIR=/home/${USERNAME}
ARG APP_DIR=${HOME_DIR}/app
RUN adduser -D -u 1000 ${USERNAME} \
  && mkdir -p ${APP_DIR} \
  && chown -R ${USERNAME}:${USERNAME} ${HOME_DIR}
USER ${USERNAME}
WORKDIR ${APP_DIR} 
COPY --chown=${USERNAME}:${USERNAME} ./package.json ./package.json
COPY --chown=${USERNAME}:${USERNAME} ./package-lock.json ./package-lock.json
COPY --chown=${USERNAME}:${USERNAME} ./.npmrc ./.npmrc
RUN npm ci
COPY --chown=${USERNAME}:${USERNAME} . .
RUN git config --global --add safe.directory ${APP_DIR}
RUN npm run build
ENTRYPOINT [ "/bin/sh", "-c" ]
CMD [ "/usr/local/searxng/dockerfiles/docker-entrypoint.sh -f & (npm start -- --host)" ]
