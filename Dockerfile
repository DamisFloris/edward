# Edward: backend Node + frontend compilato, in un'unica immagine (funziona su Raspberry Pi 4 a 64 bit).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY backend backend
COPY frontend frontend
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
# openssl: per creare il certificato HTTPS al primo avvio
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend backend
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir -p backend/data && chown -R node:node backend/data
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "backend/src/index.js"]
