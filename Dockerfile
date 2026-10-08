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
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates tini curl unzip openssh-client python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
RUN npm install --global @openai/codex@0.155.1 dingtalk-workspace-cli@1.0.62 @ziniao-open/cli@1.1.3 \
  && npm cache clean --force
WORKDIR /app
COPY vendor/amazon-skill /opt/amazon-skill
RUN python3 -m venv /opt/amazon-venv \
  && /opt/amazon-venv/bin/pip install --no-cache-dir /opt/amazon-skill
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY scripts ./scripts
COPY skills ./skills
COPY config ./config
COPY workspaces ./workspaces
COPY AGENTS.md ./AGENTS.md
RUN useradd --create-home --uid 10001 agent \
  && mkdir -p /var/lib/codex /var/lib/dws /var/lib/agent/media /app/workspaces /home/agent/.ziniao-cli \
  && chown -R agent:agent /app/workspaces /var/lib/codex /var/lib/dws /var/lib/agent /home/agent/.ziniao-cli
USER agent
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
