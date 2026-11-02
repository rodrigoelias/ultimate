## Developing in Docker

`compose.yaml` runs Ultimate on its own repository inside a container. Node, pnpm, Git, Chromium, the Claude Code CLI
and every dependency live in the image and in Docker volumes. The host needs only Docker.

```bash
docker compose up --build
```

Open http://localhost:4747. If that port is taken on the host, pick another range; the container uses the same
numbers:

```bash
ULTIMATE_PORTS=4757-4766 ULTIMATE_PORT=4757 docker compose up --build
```

Machine-specific values such as these and `PROJECTS_DIR` belong in a `.env` next to `compose.yaml`, which compose
reads on its own and Git ignores.

### What lives where

- **The checkout** is bind-mounted at `/workspace`. Edits on either side show up on the other, and hot reload works
  as in [running.md](running.md).
- **`node_modules` and the pnpm store** are in the `node_modules` volume. The host's `node_modules/` stays an empty
  mount point. The container runs `pnpm install` on every start, so a lockfile change needs no rebuild.
- **Logins, Ultimate's state (`~/.ultimate`, `~/.pi/agent`) and Git config** are in the `home` volume, at
  `/home/node`. They survive `docker compose down`; `docker compose down -v` deletes them.
- **Your projects** are bind-mounted at `/projects` from the folder in `PROJECTS_DIR` (below); without it, `/projects`
  is an empty volume.
- **The projects' images and containers** are in the `dind` volume, the image store of the `dind` service.

### First steps inside the container

Run commands with `docker compose exec ultimate <command>`, for example:

```bash
docker compose exec ultimate git config --global user.name "Your Name"
docker compose exec ultimate git config --global user.email you@example.com
docker compose exec ultimate claude auth login
docker compose exec ultimate pnpm check
```

`claude auth login` signs in the Claude Code provider; other providers log in from the UI as usual.

### How the ports work

Ultimate binds only `127.0.0.1`, which a container keeps to itself. For every port in `ULTIMATE_PORTS`,
`docker/entrypoint.sh` runs `socat` on the container's own address and forwards to the same port on `127.0.0.1`;
compose publishes the range on the host's `127.0.0.1` under the same numbers. Ultimate accepts only requests whose
`Host` names its own loopback port, so the numbers must match. `ULTIMATE_PORT` must lie in the range.

### Working on other projects

Point `PROJECTS_DIR` at the host folder that holds your projects, in `.env`:

```bash
PROJECTS_DIR=/Users/you/code
```

Then `docker compose up -d` recreates the containers; `my-app` in that folder is `/projects/my-app` inside. Ultimate
sees every project in the folder. Start an Ultimate for one of them on the next free port of the range:

```bash
docker compose exec -d -e ULTIMATE_PORT=4748 ultimate node /workspace/bin/ultimate.ts /projects/my-app
```

and open http://localhost:4748. It shares the logins of the first one; its state goes to its own home in the `home`
volume.

### Projects' own containers

The `dind` service is a Docker daemon of its own for the projects' containers. The `ultimate` container reaches it with
`DOCKER_HOST=tcp://dind:2375` and the Docker CLI with compose, so `docker compose up` in `/projects/my-app` runs that
project's stack there. Both containers mount the projects at `/projects`, so a project's own bind mounts (`.:/app`)
resolve to the same files.

Ports the projects' containers publish in `PROJECT_PORTS` (default `3000-3099`) reach the host's `127.0.0.1` under the
same numbers: a dev server on port 3000 opens at http://localhost:3000. From the `ultimate` container, and so from
Ultimate's browser tools, it is http://dind:3000. A dev server that checks the `Host` header (Vite's `allowedHosts`)
may need `dind` allowed.

**The boundary.** `dind` runs rootless: its daemon and every container it starts run as an unprivileged user, so even
a `--privileged` project container cannot reach the Docker host or its files beyond the mounted projects. The `dind`
container itself needs `privileged: true` to make its user namespaces. Its API is reachable only on the compose
network, never published.

**Costs.** The image store is separate from the host's, so the first build of every project pulls and builds from
scratch, and its images take disk in the Docker VM (a typical dev stack 1–3 GB, plus build cache). The daemon itself
idles at around 100 MB of memory. Rootless Docker here has no cgroup controllers, so `mem_limit`, `cpus` and
`--memory` have no effect: a project's containers share the Docker VM's memory and CPUs with everything else. `docker
compose down -v` deletes the `dind` volume with everything in it.

**Ultimate's bash in a project's container.** With the optional `containers` extension on, bash calls in a project
with a `.devcontainer/devcontainer.json` run inside its dev container; see
[extensions/containers](../extensions/containers/README.md). Put that project's worktrees under `/projects` too, so
the container can mount them at the same path, in its `.ultimate/settings.json`:

```json
{
  "extensions": { "enable": ["containers"] },
  "isolates": { "worktree": { "path": "/projects/.ultimate-worktrees/my-app/{name}" } }
}
```

### Not covered

- Pushing to GitHub: the container has no Git credentials. Push from wherever your credentials live, or add an SSH
  key to the `home` volume.
- Tailscale remote access.
- Git is built from source because Debian's is older than 2.54; the first build takes a few minutes.
