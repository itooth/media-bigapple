FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# dependencies 只放服务端运行时要用的包（案例搜索：minisearch、pinyin-pro）；前端包在构建时打进 dist。
FROM node:24-bookworm-slim AS runtime-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server ./server
COPY works ./works
COPY src/lib ./src/lib
COPY src/data/eventSlugs.json ./src/data/eventSlugs.json
COPY bootstrap ./bootstrap
COPY agent ./agent
COPY scripts/backup-data.mjs ./scripts/backup-data.mjs
EXPOSE 3000
CMD ["node", "server/index.mjs"]
