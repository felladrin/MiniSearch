FROM searxng/searxng:2023.10.22-526d5c7b3
ENV PORT ${PORT:-7860}
EXPOSE ${PORT}
RUN sed -i 's/- html/- json/' /usr/local/searxng/searx/settings.yml
RUN apk add --update nodejs npm
WORKDIR /app
COPY . .
RUN npm ci
ENTRYPOINT [ "/bin/sh", "-c" ]
CMD [ "/usr/local/searxng/dockerfiles/docker-entrypoint.sh -f & npm start" ]
