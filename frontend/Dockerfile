FROM node:24-alpine AS build

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# dependencies first, so code changes don't reinstall them
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The /api and /media rewrites are baked in at build time. Caddy routes those paths to the API before
# they reach Next.js, so in production they only matter if Next.js is opened directly.
ARG API_URL=http://api:8000
ENV API_URL=$API_URL
RUN npm run build

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# output: "standalone" in next.config.ts: server.js with only the node_modules it needs
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
