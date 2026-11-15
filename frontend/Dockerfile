# Managed file. Edit it in sirloinbh/project-standards templates/app/frontend/
# The package auth token is received only as a BuildKit secret (npm_token). It is not passed through ARG or ENV, so it does not stay in an image layer.
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install --global npm@11.19.0 --ignore-scripts
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci --ignore-scripts
COPY . .
RUN npm run build
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
