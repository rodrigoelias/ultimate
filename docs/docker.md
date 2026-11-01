## Developing in Docker

`compose.yaml` runs Ultimate on its own repository inside a container. Node, pnpm, Git, Chromium, the Claude Code CLI
and every dependency live in the image and in Docker volumes. The host needs only Docker.

```bash
docker compose up --build
```

Open http://localhost:4747. If that port is taken on the host, pick another; the container uses the same number:

```bash
ULTIMATE_PORT=4757 docker compose up --build
```

### What lives where

- **The checkout** is bind-mounted at `/workspace`. Edits on either side show up on the other, and hot reload works
  as in [running.md](running.md).
- **`node_modules` and the pnpm store** are in the `node_modules` volume. The host's `node_modules/` stays an empty
  mount point. The container runs `pnpm install` on every start, so a lockfile change needs no rebuild.
- **Logins, Ultimate's state (`~/.ultimate`, `~/.pi/agent`) and Git config** are in the `home` volume, at
  `/home/node`. They survive `docker compose down`; `docker compose down -v` deletes them.

### First steps inside the container

Run commands with `docker compose exec ultimate <command>`, for example:

```bash
docker compose exec ultimate git config --global user.name "Your Name"
docker compose exec ultimate git config --global user.email you@example.com
docker compose exec ultimate claude auth login
docker compose exec ultimate pnpm check
```

`claude auth login` signs in the Claude Code provider; other providers log in from the UI as usual.

### How the port works

Ultimate binds only `127.0.0.1`, which a container keeps to itself. `docker/entrypoint.sh` runs `socat` on port 4748
and forwards to Ultimate on `127.0.0.1:$ULTIMATE_PORT`; compose publishes 4748 on the host's `127.0.0.1` under the
same `ULTIMATE_PORT`. Ultimate accepts only requests whose `Host` names its own loopback port, so the two numbers
must match.

### Not covered

- Pushing to GitHub: the container has no Git credentials. Push from wherever your credentials live, or add an SSH
  key to the `home` volume.
- Tailscale remote access.
- Git is built from source because Debian's is older than 2.54; the first build takes a few minutes.
