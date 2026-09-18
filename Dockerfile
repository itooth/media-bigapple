FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server ./server
COPY bootstrap ./bootstrap
COPY scripts/backup-data.mjs ./scripts/backup-data.mjs
EXPOSE 3000
CMD ["node", "server/index.mjs"]
