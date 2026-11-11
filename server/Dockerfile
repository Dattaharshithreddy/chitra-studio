FROM node:22-alpine
WORKDIR /srv
COPY shared ./shared
COPY app/www ./app/www
COPY shared/presets.js shared/catalog.json ./app/www/
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/src ./server/src
ENV PORT=8787 DATA_DIR=/data
EXPOSE 8787
CMD ["node", "server/src/index.js"]
