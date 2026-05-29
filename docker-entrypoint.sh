#!/bin/bash
set -e

# Start Next.js server in background
node server.js &
NEXT_PID=$!

# Start BullMQ workers in background
bun run bullmq/workers/index.ts &
WORKERS_PID=$!

# Trap shutdown signals and forward to child processes
shutdown() {
  echo "Shutting down..."
  kill -TERM "$WORKERS_PID" 2>/dev/null || true
  kill -TERM "$NEXT_PID" 2>/dev/null || true
  wait "$WORKERS_PID" 2>/dev/null || true
  wait "$NEXT_PID" 2>/dev/null || true
  exit 0
}
trap shutdown SIGTERM SIGINT

# Wait for either process to exit
wait -n
EXIT_CODE=$?

# If one exits, kill the other
shutdown
exit $EXIT_CODE
