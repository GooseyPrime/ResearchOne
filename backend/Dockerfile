FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:22-alpine AS production

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./src/db/migrations

RUN mkdir -p logs exports

EXPOSE 3001
CMD ["node", "dist/index.js"]
