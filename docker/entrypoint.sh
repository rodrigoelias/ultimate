#!/bin/sh
set -e
# Ultimate binds only 127.0.0.1 inside the container. Forward each published port from the container's own address to
# the same port on loopback, where the Ultimate process that took it listens. compose.yaml publishes them on the host
# under the same numbers, so Ultimate's loopback Host check passes.
ip=$(node -p "Object.values(require('node:os').networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal).address")
first=${ULTIMATE_PORTS%-*}
last=${ULTIMATE_PORTS#*-}
if [ "$ULTIMATE_PORT" -lt "$first" ] || [ "$ULTIMATE_PORT" -gt "$last" ]; then
  echo "ULTIMATE_PORT $ULTIMATE_PORT is outside ULTIMATE_PORTS $ULTIMATE_PORTS; set both (docs/docker.md)." >&2
  exit 1
fi
port=$first
while [ "$port" -le "$last" ]; do
  socat TCP-LISTEN:"$port",bind="$ip",fork,reuseaddr TCP:127.0.0.1:"$port" &
  port=$((port + 1))
done
pnpm install --frozen-lockfile
exec "$@"
