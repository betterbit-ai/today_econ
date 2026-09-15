FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
COPY src ./src

RUN npm ci --omit=dev --ignore-scripts

RUN addgroup -S diem && adduser -S diem -G diem && mkdir -p /var/lib/diem-mcp && chown -R diem:diem /app /var/lib/diem-mcp
USER diem

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "src/server.js"]
