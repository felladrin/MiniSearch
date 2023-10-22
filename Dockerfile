FROM searxng/searxng:2023.10.22-526d5c7b3
ENV PORT ${PORT:-7860}
EXPOSE ${PORT}
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml
RUN sed -i 's/su-exec searxng:searxng //' /usr/local/searxng/dockerfiles/docker-entrypoint.sh
RUN mkdir -p /etc/searxng && chmod 777 /etc/searxng
RUN apk add --update nodejs npm
RUN adduser -D -u 1000 user
USER user
WORKDIR /home/user/app
COPY --chown=user . .
RUN npm ci
ENTRYPOINT [ "/bin/sh", "-c" ]
CMD [ "/usr/local/searxng/dockerfiles/docker-entrypoint.sh -f & npm start" ]
