FROM node:20
WORKDIR /home/node/app
COPY . .
RUN chown -R node:node /home/node/app
USER node
ENV PORT 7860
EXPOSE ${PORT}
RUN npm ci
CMD ["npm", "start"]