# 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/app/frontend/에서
# 패키지 인증 토큰은 BuildKit secret(npm_token)으로만 받는다. ARG·ENV로 넘기지 않으므로 이미지 레이어에 남지 않는다.
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
