# context = repo root（見 docker-compose.yml）
FROM node:20-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . /repo
RUN pnpm install --filter @chaintrust/wallet... \
  && pnpm --filter @chaintrust/wallet build

FROM nginx:alpine
COPY packages/wallet/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/packages/wallet/dist /usr/share/nginx/html
EXPOSE 80
