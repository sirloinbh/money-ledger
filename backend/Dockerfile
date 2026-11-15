# Managed file. Edit it in sirloinbh/project-standards templates/app/backend/
# The package auth token is received only as a BuildKit secret (npm_token). It is not passed through ARG or ENV, so it does not stay in an image layer.
FROM node:24.21.0-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install --global npm@11.19.0 --ignore-scripts
RUN --mount=type=secret,id=npm_token NODE_AUTH_TOKEN="$(cat /run/secrets/npm_token 2>/dev/null)" npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --ignore-scripts
FROM node:24.21.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3105
CMD ["node", "dist/server.js"]
