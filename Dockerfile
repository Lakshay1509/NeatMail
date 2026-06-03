# syntax=docker/dockerfile:1

# ---- deps ----
FROM oven/bun:1-alpine AS deps
RUN apk add --no-cache openssl
WORKDIR /app

COPY package.json bun.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN --mount=type=cache,target=/root/.bun \
    bun install --frozen-lockfile --ignore-scripts


# ---- build ----
FROM oven/bun:1-alpine AS builder
RUN apk add --no-cache openssl nodejs
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=1024"
ENV NEXT_TELEMETRY_DISABLED=1
ENV GENERATE_SOURCEMAP=false
# Cap Bun's JSC memory: pretends system has 2GB so GC runs aggressively.
# Value is in bytes. Prevents OOM on 4GB VPS (Bun ignores --max-old-space-size).
ENV BUN_JSC_forceRAMSize=2147483648

ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_API_URL
ARG DATABASE_URL
ARG DIRECT_URL
ARG REDIS_URL
ARG OPENAI_API_KEY

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_URL=$DIRECT_URL
ENV REDIS_URL=$REDIS_URL
ENV OPENAI_API_KEY=$OPENAI_API_KEY

# --smol reduces Bun's memory footprint at a slight build-speed cost.
# Combined with BUN_JSC_forceRAMSize, keeps the build under 3GB on 4GB VPS.
RUN --mount=type=cache,target=/app/.next/cache \
    bun --smol run build


# ---- runtime ----
FROM node:22-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"
ENV NODE_OPTIONS="--max-old-space-size=768"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@bull-board ./node_modules/@bull-board

USER nextjs

EXPOSE 8080

CMD ["node", "server.js"]
