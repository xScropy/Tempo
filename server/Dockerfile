# Build:  docker build -f server/Dockerfile -t tempo-social .
# Run:    docker run -p 47800:47800 -v tempo-social:/data tempo-social
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/social ./src/social
COPY server ./server
RUN npm run build:server

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/server/dist/server.cjs ./server.cjs
ENV PORT=47800 DATA_DIR=/data
VOLUME /data
EXPOSE 47800
USER node
CMD ["node", "server.cjs"]
