# context = repo root（見 docker-compose.yml）
FROM node:20-slim

WORKDIR /repo
RUN corepack enable

# 複製 workspace（.dockerignore 已排除 node_modules/dist）
COPY . /repo

RUN pnpm install --filter @chaintrust/issuer-verifier... \
  && pnpm --filter @chaintrust/issuer-verifier build

WORKDIR /repo/packages/issuer-verifier
ENV CHAIN_MODE=memory
ENV AI_SERVICE_URL=http://ai-service:8000
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/server.js"]
