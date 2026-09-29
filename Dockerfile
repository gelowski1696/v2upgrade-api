FROM node:22-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY prisma7.config.ts prisma-store.config.ts ./
COPY prisma ./prisma
COPY src ./src

RUN npm run db:generate \
  && npm run db:generate:store \
  && npm run build

FROM node:22-bookworm-slim AS runtime

ARG BUILD_RELEASE=development
ARG APP_VERSION=0.0.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
  APP_RELEASE=${BUILD_RELEASE} \
  APP_VERSION=${APP_VERSION}

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=build --chown=node:node /app/prisma-store.config.ts ./prisma-store.config.ts
COPY --chown=node:node scripts ./scripts

RUN mkdir -p /app/data /app/backups \
  && chown -R node:node /app/data /app/backups

USER node
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npm run db:deploy && node dist/main.js"]
