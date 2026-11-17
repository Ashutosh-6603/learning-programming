# syntax=docker/dockerfile:1

# ---- base: Debian slim (glibc, so argon2's prebuilt binary loads) ----
FROM node:24.22.2-slim AS base
WORKDIR /app

# ---- deps: every dependency, dev tools included, to compile ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: `nest build` compiles src/ to dist/ (and runs the Swagger plugin) ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: compiled code only; migrations are compiled into dist/ with everything else ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]
