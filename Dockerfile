# Stage 1: Build client
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Build server
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npx tsc

# Stage 3: Production
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY server/package*.json ./server/
WORKDIR /app/server
RUN npm ci --omit=dev
WORKDIR /app

COPY --from=server-build /app/server/dist ./server/dist
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p server/uploads/images server/uploads/voice server/uploads/video server/uploads/files server/data

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["node", "server/dist/index.js"]
