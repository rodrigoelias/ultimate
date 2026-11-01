#!/bin/sh
set -e
# Ultimate binds only 127.0.0.1 inside the container; forward the published port to it.
# compose.yaml publishes it on the host under the same ULTIMATE_PORT, so Ultimate's loopback Host check passes.
socat TCP-LISTEN:4748,fork,reuseaddr TCP:127.0.0.1:"${ULTIMATE_PORT:-4747}" &
pnpm install --frozen-lockfile
exec "$@"
