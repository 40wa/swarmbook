FROM oven/bun:1.3.14-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY src ./src

RUN mkdir -p /data && chown -R bun:bun /app /data

USER bun

ENV HOST=0.0.0.0
ENV PORT=3000
ENV SWARMBOOK_DB_PATH=/data/swarmbook.sqlite

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=5 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:3000/health'); process.exit(response.ok ? 0 : 1)"

CMD ["bun", "run", "start"]
