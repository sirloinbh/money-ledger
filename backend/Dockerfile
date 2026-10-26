# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/backend/에서
# 패키지 인증 토큰은 BuildKit secret(npm_token)으로만 받는다. ARG·ENV로 넘기지 않으므로 이미지 레이어에 남지 않는다.
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
