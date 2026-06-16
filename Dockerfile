# Dockerfile for relay-patch orchestrator testing
# Runs the full re-derive → apply flow in isolation (no host contamination)

FROM oven/bun:1.3.14-alpine

RUN apk add --no-cache git bash

WORKDIR /app

# Copy tool source
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY index.ts ./
RUN bun install

# Copy test script
COPY test-orchestrator.sh /app/test-orchestrator.sh
RUN chmod +x /app/test-orchestrator.sh

# Default: run the orchestrator test
CMD ["/app/test-orchestrator.sh"]
