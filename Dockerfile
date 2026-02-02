# ---- deps: Node 22 + Bun + OpenSSL ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update -y && \
    apt-get install -y curl openssl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy lockfiles for better caching
COPY package.json bun.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

# Install dependencies - skip postinstall scripts to avoid prisma generate
RUN bun install --frozen-lockfile --ignore-scripts


# ---- build ----
FROM node:22-bookworm-slim AS builder
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Copy Bun
COPY --from=deps /root/.bun /root/.bun
ENV BUN_INSTALL=/root/.bun
ENV PATH=$BUN_INSTALL/bin:$PATH

# Copy deps + source
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# === Build-time Public Env Variables ===
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL
ARG NEXT_PUBLIC_API_URL
ARG DATABASE_URL
ARG DIRECT_URL
ARG UPSTASH_REDIS_URL
ARG UPSTASH_REDIS_TOKEN
ARG OPENAI_API_KEY


ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV DATABASE_URL=$DATABASE_URL
ENV DIRECT_URL=$DIRECT_URL
ENV UPSTASH_REDIS_URL=$UPSTASH_REDIS_URL
ENV UPSTASH_REDIS_TOKEN=$UPSTASH_REDIS_TOKEN
ENV OPENAI_API_KEY=$OPENAI_API_KEY

# === Build the Next.js app ===
RUN bunx prisma generate && bun run build


# ---- runtime ----
FROM node:22-bookworm-slim AS runner
RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Copy Prisma schema and generated client (Prisma 7 generates to prisma/generated/prisma)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy only what's needed for runtime
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Expose and run
EXPOSE 8080
CMD ["node", "server.js"]