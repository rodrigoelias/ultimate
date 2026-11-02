Runs a project's bash calls in the project's own dev container: the one its `.devcontainer/devcontainer.json` (or
`.devcontainer.json`) describes, started with the pinned [Dev Containers CLI](https://github.com/devcontainers/cli).
Off by default; projects without a devcontainer.json are unaffected even with it on.

## Settings

Turn it on for one project in its `.ultimate/settings.json`, together with where its worktrees go:

```json
{
  "extensions": { "enable": ["containers"] },
  "isolates": { "worktree": { "path": "/projects/.ultimate-worktrees/my-app/{name}" } }
}
```

It needs a Docker daemon whose bind mounts see the project at the same path as Ultimate does, such as the `dind`
service of Ultimate's own `compose.yaml` ([docs/docker.md](../../docs/docker.md#projects-own-containers)). The
devcontainer.json must mount the project at its own path (`workspaceFolder: "${localWorkspaceFolder}"` and a bind
mount `source=${localWorkspaceFolder},target=${localWorkspaceFolder}`), so a bash call's working directory names the
same files inside. The folder `isolates.worktree.path` puts checkouts in is mounted at its own path too, so branches'
bash runs in the same container. A `~/` path is not mounted, and bash there runs locally. The mount is the template's
parent folder: give each project a folder of its own (`…/my-app/{name}`, not `…/trees/my-app-{name}`), or other
projects' checkouts in it are mounted too. A container created before the setting needs a Stop and Start (or a
rebuild) to get the mount; until then bash in worktrees runs locally.

The container's user must be able to write the project and its `.git`, or commits made inside are not recorded:
with rootless Docker, a `remoteUser` other than root maps to a uid that does not own the files.

## How bash runs

coding-tools asks the `coding-tools.shell` extension point (`extensions/coding-tools/api.ts`) where each bash call
runs; this extension provides it. A call whose working directory is in the project or its worktrees folder:

1. Starts the container on first use (`devcontainer up`, reused afterwards; a first build can take minutes), with the
   worktrees folder as an extra mount. A cancel or steering message stops the call's wait, not the start; the call's timeout counts from when its command runs. After a failed start,
   bash in the project fails at once with the reason (it does not fall back to running here), until Start is pressed
   or devcontainer.json changes.
2. Runs through `devcontainer exec --container-id … sh -c …` in the same folder, with the container's own environment
   plus the call's commit hooks (`GIT_CONFIG_*`), `safe.directory=*` and the project's `user.name`/`user.email`. The
   hooks' log goes to a file in the project's `.git`, which both sides see, so commits made inside are recorded like
   any other.
3. Runs the command in a session of its own inside the container, whose stdin is held open by the local call. A
   cancel or timeout kills the local process group, which closes stdin, and the container kills the session: nothing
   keeps running inside.

Calls elsewhere (`/tmp`, Ultimate's own checkout) run locally as before. Commit attribution needs git 2.54 or newer
in the container; an older one shows a hint in the status (`apk add git` on Alpine 3.24).

## UI and actions

The status line's `container` item shows whether the dev container runs (green), is stopped (grey) or failed to
start (amber). Its popover lists the published ports as `localhost` links and has Start or Stop; `Dev container…` in
the palette opens it. Actions: `status`, `start`, `stop` (`refs.ts`); stop stops every service of its compose project.
The prompt section `project_container` tells agents that bash runs inside, and where published ports open.
