FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
ENV BRAND_ORIGIN=https://media.bigapple.work BRAND_RESELLER_ID=__RESELLER_ID__
COPY gateway ./gateway
COPY server/response.mjs ./server/response.mjs
EXPOSE 3000
CMD ["node", "gateway/server.mjs"]
