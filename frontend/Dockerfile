# syntax=docker/dockerfile:1.7

# @bryanadamg/terras-ui resolves from GitHub Packages (see .npmrc), which needs a
# token. It is mounted as a BuildKit secret rather than passed as an ARG so it
# never lands in an image layer or in `docker history`. Compose supplies it from
# the NODE_AUTH_TOKEN environment variable — see the `secrets:` block in
# docker-compose.yml.

# Stage: Dev (hot reload) — NOT the default target; `runner` stays last so
# `docker compose build frontend` without a target still produces the prod image.
FROM node:20-alpine AS dev
WORKDIR /app
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=node_auth_token,required=true \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" npm ci
COPY . .
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN --mount=type=secret,id=node_auth_token,required=true \
    NODE_AUTH_TOKEN="$(cat /run/secrets/node_auth_token)" npm ci
COPY . .
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build

# Stage 2: Run
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
