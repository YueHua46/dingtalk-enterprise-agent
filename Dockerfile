ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM ${NODE_IMAGE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates tini curl unzip \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global @openai/codex@0.155.1 dingtalk-workspace-cli@1.0.62 \
  && npm cache clean --force
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts
COPY skills ./skills
COPY workspaces ./workspaces
COPY AGENTS.md ./AGENTS.md
RUN useradd --create-home --uid 10001 agent \
  && mkdir -p /var/lib/codex /var/lib/dws /var/lib/agent/media /app/workspaces \
  && chown -R agent:agent /app/workspaces /var/lib/codex /var/lib/dws /var/lib/agent
USER agent
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
