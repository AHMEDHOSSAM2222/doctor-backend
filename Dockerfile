# doctor-backend API image. Used by deploy/docker-compose.yml.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY schema.sql ./
COPY src ./src

# Uploaded PDFs live here; docker-compose mounts a volume on it so they survive updates.
RUN mkdir -p data/uploads && chown -R node:node data
USER node

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

CMD ["node", "src/server.js"]
