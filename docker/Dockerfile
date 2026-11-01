# Development container for Ultimate: Node, pnpm, Git, Chromium and the Claude Code CLI live here,
# not on the host. See docs/docker.md.

# Debian's Git is older than the 2.54 that commit attribution needs (extensions/coding-tools/README.md).
FROM debian:trixie-slim AS git
ARG GIT_VERSION=2.54.0
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils make gcc libc6-dev libcurl4-openssl-dev libexpat1-dev \
      libssl-dev zlib1g-dev gettext \
 && curl -fsSL https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_VERSION}.tar.xz | tar -xJ -C /tmp \
 && make -C /tmp/git-${GIT_VERSION} -j"$(nproc)" prefix=/opt/git NO_TCLTK=1 NO_PERL=1 NO_PYTHON=1 all install

FROM node:26-trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl libcurl4t64 libexpat1 openssh-client less ripgrep socat chromium fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*
COPY --from=git /opt/git /opt/git
# The checkout is a bind mount owned by the host user, which Git would otherwise refuse.
RUN mkdir -p /opt/git/etc && /opt/git/bin/git config --system --add safe.directory '*'

ARG PNPM_VERSION=11.8.0
RUN npm install -g pnpm@${PNPM_VERSION} @anthropic-ai/claude-code && npm cache clean --force

COPY docker/entrypoint.sh /usr/local/bin/ultimate-entrypoint
# The node_modules volume takes this owner when Docker first creates it.
RUN mkdir -p /workspace/node_modules && chown node:node /workspace/node_modules
USER node
WORKDIR /workspace
# The pnpm store shares the node_modules volume, so pnpm can hard link and nothing lands in the checkout.
ENV PATH=/opt/git/bin:$PATH ULTIMATE_CHROMIUM=/usr/bin/chromium ULTIMATE_NO_OPEN=1 \
    pnpm_config_store_dir=/workspace/node_modules/.pnpm-store pnpm_config_update_notifier=false
EXPOSE 4748
ENTRYPOINT ["ultimate-entrypoint"]
CMD ["pnpm", "start"]
