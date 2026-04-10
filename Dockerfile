FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build:lib

FROM node:22-alpine

RUN addgroup -g 1001 -S declarenta && \
    adduser -S declarenta -u 1001 -G declarenta

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

USER declarenta

ENTRYPOINT ["node", "dist/cli.js"]
