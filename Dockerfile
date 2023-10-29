FROM searxng/searxng:2023.10.22-526d5c7b3
ENV PORT ${PORT:-7860}
EXPOSE ${PORT}
RUN apk add --update \
  nodejs \
  npm
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml \
  && sed -i 's/su-exec searxng:searxng //' /usr/local/searxng/dockerfiles/docker-entrypoint.sh \
  && mkdir -p /etc/searxng \
  && chmod 777 /etc/searxng
ARG USERNAME=user
RUN adduser -D -u 1000 ${USERNAME} \
  && mkdir -p /home/${USERNAME}/app \
  && chown -R ${USERNAME}:${USERNAME} /home/${USERNAME}
USER user
WORKDIR /home/${USERNAME}/app 
COPY --chown=${USERNAME}:${USERNAME} . .
RUN npm ci \
  && npm run build
ENTRYPOINT [ "/bin/sh", "-c" ]
CMD [ "/usr/local/searxng/dockerfiles/docker-entrypoint.sh -f & npm start" ]
