# syntax=docker/dockerfile:1

# ---- base: Debian slim + OpenSSL (Prisma's schema engine links against libssl 3) ----
FROM node:24.22.2-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- deps: all dependencies; postinstall runs `prisma generate`.
#      Also the image the compose `migrate` service runs (it needs the Prisma CLI). ----
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build: compile TypeScript (including the generated Prisma client) to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only. The Prisma CLI is a devDependency that the lockfile
#      also marks "devOptional" (an optional peer of @prisma/client), so omit optional too. ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]
