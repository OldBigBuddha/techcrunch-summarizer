FROM oven/bun:latest
WORKDIR /usr/src/app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY index.ts tsconfig.json ./

USER bun
ENTRYPOINT [ "bun", "run", "index.ts" ]