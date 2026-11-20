# Managed file. Edit it in sirloinbh/project-standards templates/app/backend/
# Built from the repo root with the root package-lock.json (ADR-0022): docker build -f backend/Dockerfile .
# The package auth token is received only as a BuildKit secret (npm_token). It is not passed through ARG or ENV, so it does not stay in an image layer.
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm install --global npm@11.19.0 --ignore-scripts
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci --ignore-scripts -w backend
COPY . .
RUN npm run build -w backend
FROM node:24.21.0-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm install --global npm@11.19.0 --ignore-scripts
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci --omit=dev --ignore-scripts -w backend
RUN mkdir -p backend/node_modules
FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/
WORKDIR /app/backend
USER node
EXPOSE 3105
CMD ["node", "dist/server.js"]
