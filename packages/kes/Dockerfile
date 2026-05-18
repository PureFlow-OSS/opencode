FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json .
RUN bun install --production
COPY src ./src
EXPOSE 5000
CMD ["bun", "run", "src/index.ts"]
