ARG BASE_IMAGE=dingtalk-enterprise-agent-gateway:latest
FROM ${BASE_IMAGE}

COPY dist/guide-tool.js /app/dist/guide-tool.js
COPY dist/config.js /app/dist/config.js
COPY dist/server.js /app/dist/server.js
COPY dist/dingtalk-directory.js /app/dist/dingtalk-directory.js
COPY skills/amazon-business-performance-analysis /app/skills/amazon-business-performance-analysis
