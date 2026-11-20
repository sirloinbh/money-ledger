# Managed file. Edit it in sirloinbh/project-standards templates/app/frontend/
# Built from the repo root with the root package-lock.json (ADR-0022): docker build -f frontend/Dockerfile .
# The package auth token is received only as a BuildKit secret (npm_token). It is not passed through ARG or ENV, so it does not stay in an image layer.
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm install --global npm@11.19.0 --ignore-scripts
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci --ignore-scripts -w frontend
COPY . .
RUN npm run build -w frontend
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
