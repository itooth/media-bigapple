FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY gateway ./gateway
COPY server/response.mjs ./server/response.mjs
EXPOSE 3000
CMD ["node", "gateway/server.mjs"]
