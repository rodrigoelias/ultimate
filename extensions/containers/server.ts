import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineExtension, section } from '@earendil-works/pi-durable'
import type { BashExecution } from '@earendil-works/pi-durable/tools'
import { exec } from '../../lib/exec.ts'
import { git } from '../../lib/git.ts'
import { implementAction } from '../../lib/actions.ts'
import type { ExtensionAction } from '../../server/actions.ts'
import type { ExtensionHost } from '../../server/extensions.ts'
import { Shell } from '../coding-tools/api.ts'
import { StartAction, StatusAction, StopAction } from './refs.ts'
import type { Port, Status } from './refs.ts'

/** The Dev Containers CLI this package pins: it reads devcontainer.json and starts what it describes. */
const cli = fileURLToPath(import.meta.resolve('@devcontainers/cli/devcontainer.js'))
/** Commit attribution needs it: older git ignores the hooks coding-tools passes in its environment. */
const minimumGit = [2, 54]

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`
const inside = (folder: string, path: string) => {
  const rest = relative(folder, path)
  return !rest.startsWith('..') && !isAbsolute(rest)
}

/** The project's devcontainer.json, where the Dev Containers CLI looks for it. */
export function configPath(projectRoot: string) {
  return [
    join(projectRoot, '.devcontainer/devcontainer.json'),
    join(projectRoot, '.devcontainer.json'),
  ].find((path) => existsSync(path))
}

/**
 * The folder `isolates.worktree.path` puts every checkout in, mounted into the container at the same path so bash in
 * a branch's worktree runs there too; undefined without the setting or for a `~/` path, which no container shares.
 */
export function worktreesFolder(settings: unknown) {
  const template = (settings as { isolates?: { worktree?: { path?: unknown } } }).isolates?.worktree
    ?.path
  if (typeof template !== 'string' || !template.includes('{name}') || !isAbsolute(template))
    return undefined
  return dirname(template.slice(0, template.indexOf('{name}')) + 'name')
}

/** The ports in `docker ps`'s Ports column (`0.0.0.0:3000->3000/tcp, [::]:3000->3000/tcp`), once each. */
export function parsePorts(service: string, column: string): Port[] {
  const seen = new Map<number, Port>()
  for (const [, host, container] of column.matchAll(/:(\d+)->(\d+)\/tcp/g))
    seen.set(Number(host), { service, host: Number(host), container: Number(container) })
  return [...seen.values()]
}

/**
 * Inside the container: run `$2` in folder `$1` in a session of its own, and kill that session when stdin closes. The
 * Docker client keeps stdin open while it lives; killing the client (a cancel or timeout of the bash call) closes it,
 * which `docker exec` alone would not pass on: the command would run on.
 */
const inner = `cd "$1" || exit 1
s=bash; command -v bash >/dev/null || s=sh
exec 3<&0
setsid "$s" -c "$2" </dev/null & p=$!
(cat <&3 >/dev/null; kill -KILL -- -$p 2>/dev/null) & w=$!
wait $p; r=$?
kill $w 2>/dev/null
exit $r`

/**
 * The local command that runs bash call `execution` in container `id` of the project at `root`, with `env` (and no
 * other variable of this process). Its stdin is a pipe held open by a sleep of the call's process group: a cancel kills
 * the group and so closes it; a finished call kills the sleep.
 */
export function containerCommand(
  execution: Pick<BashExecution, 'command' | 'cwd'>,
  root: string,
  id: string,
  env: Record<string, string>,
) {
  const args = [
    process.execPath,
    cli,
    'exec',
    '--workspace-folder',
    root,
    '--container-id',
    id,
    ...Object.entries(env).flatMap(([key, value]) => ['--remote-env', `${key}=${value}`]),
    'sh',
    '-c',
    inner,
    '-',
    execution.cwd,
    execution.command,
  ]
  return `exec 3< <(exec sleep 2147483647 2>/dev/null); s=$!
${args.map(quote).join(' ')} <&3 3<&-; r=$?
kill $s; exit $r`
}

type Container = { id: string; name: string; running: boolean; mounts: string[]; project?: string }

const docker = async (...args: string[]) =>
  (await exec('docker', args, { timeout: 30000, maxBuffer: 16 * 1024 * 1024 })).stdout.trim()

/** The dev container the CLI made for `root`, found by the label it sets; undefined before the first start. */
async function find(root: string): Promise<Container | undefined> {
  const id = (await docker('ps', '-aq', '--filter', `label=devcontainer.local_folder=${root}`))
    .split('\n')
    .find(Boolean)
  if (!id) return undefined
  const [found] = JSON.parse(await docker('inspect', id)) as {
    Id: string
    Name: string
    State: { Running: boolean }
    Mounts: { Type: string; Source: string; Destination: string }[]
    Config: { Labels: Record<string, string> }
  }[]
  return {
    id: found.Id,
    name: found.Name.replace(/^\//, ''),
    running: found.State.Running,
    // Only folders at the same path inside and out: there a bash call's cwd means the same files.
    mounts: found.Mounts.filter(
      (mount) => mount.Type === 'bind' && mount.Source === mount.Destination,
    ).map((mount) => mount.Destination),
    project: found.Config.Labels['com.docker.compose.project'],
  }
}

/** What the container and the services started with it publish. */
async function ports(container: Container) {
  const filter = container.project
    ? `label=com.docker.compose.project=${container.project}`
    : `id=${container.id}`
  const rows = await docker(
    'ps',
    '--filter',
    filter,
    '--format',
    // The name first: the output is trimmed, which would drop an empty leading column.
    '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.service"}}',
  )
  return rows
    .split('\n')
    .filter(Boolean)
    .flatMap((row) => {
      const [name, column, service] = row.split('\t')
      return parsePorts(service || name, column ?? '')
    })
    .toSorted((a, b) => a.host - b.host)
}

/** A hint when the container's git is too old to attribute commits; undefined when it is fine. */
async function gitHint(container: Container) {
  const version = await docker('exec', container.id, 'git', '--version').catch(() => '')
  const [major = 0, minor = 0] = (/(\d+)\.(\d+)/.exec(version) ?? []).slice(1).map(Number)
  if (major > minimumGit[0] || (major === minimumGit[0] && minor >= minimumGit[1])) return undefined
  return `${version ? `The container has ${version}` : 'The container has no git'}; commits made there need git ${minimumGit.join('.')} or newer to carry their conversation. Install it in the image (Alpine 3.24: apk add git).`
}

type State = {
  starting?: Promise<Container>
  error?: string
  /** The git hint of the container `id` (checked once per container). */
  hint?: { id: string; text?: string }
  prepare(execution: BashExecution): Promise<BashExecution>
  status(): Promise<Status>
  start(): Promise<Status>
  stop(): Promise<Status>
}
const states = new WeakMap<ExtensionHost, State>()
const state = (host: ExtensionHost) => {
  const found = states.get(host)
  if (!found) throw new Error('containers is not running')
  return found
}

export const actions: Record<string, ExtensionAction> = {
  status: implementAction(StatusAction, (_args, { host }) => state(host).status()),
  start: implementAction(StartAction, (_args, { host }) => state(host).start()),
  stop: implementAction(StopAction, (_args, { host }) => state(host).stop()),
}

export default function containers(host: ExtensionHost) {
  const root = host.projectRoot
  const failure = (error: unknown) => {
    const { stderr, message } = error as { stderr?: string; message?: string }
    return (stderr?.trim() || message || String(error)).slice(-2000)
  }

  /** Start (or first build) the container: the CLI reuses a running one and starts a stopped one. */
  async function up() {
    const args = [cli, 'up', '--workspace-folder', root]
    const worktrees = worktreesFolder(await host.projectSettings())
    if (worktrees) {
      await mkdir(worktrees, { recursive: true })
      args.push('--mount', `type=bind,source=${worktrees},target=${worktrees}`)
    }
    // A first build pulls images and runs the config's create commands (`npm ci`): minutes, not seconds.
    await exec(process.execPath, args, { timeout: 30 * 60_000, maxBuffer: 64 * 1024 * 1024 })
    const container = await find(root)
    if (!container?.running) throw new Error('The dev container did not start')
    return container
  }

  /** The running container, started first when it is not. One start at a time. */
  async function running() {
    const container = self.starting ? undefined : await find(root)
    if (container?.running) return container
    self.starting ??= up()
      .then((started) => {
        self.error = undefined
        return started
      })
      .catch((error: unknown) => {
        self.error = failure(error)
        throw new Error(`The project's dev container could not start: ${self.error}`, {
          cause: error,
        })
      })
      .finally(() => (self.starting = undefined))
    return self.starting
  }

  async function hintFor(container: Container) {
    if (self.hint?.id !== container.id)
      self.hint = { id: container.id, text: await gitHint(container) }
    return self.hint.text ? { hint: self.hint.text } : {}
  }

  const self: State = {
    async prepare(execution) {
      if (!configPath(root)) return execution
      // Only the project and its worktrees start the container; a call elsewhere (/tmp) runs here.
      const worktrees = worktreesFolder(await host.projectSettings())
      const shared = [root, ...(worktrees ? [worktrees] : [])]
      if (!shared.some((folder) => inside(folder, execution.cwd))) return execution
      const container = await running()
      // Ultimate's own checkout and anything else the container does not share runs here, as without containers.
      if (!container.mounts.some((mount) => inside(mount, execution.cwd))) return execution
      const env = { ...execution.env }
      // The hooks' log goes where both sides see it: the project's .git folder, which no status lists. In a project
      // opened on a linked worktree (.git is a file) its commits go unrecorded; the trailer still names the conversation.
      const log = join(root, '.git', `ultimate-commits-${randomUUID()}.log`)
      if (
        env.ULTIMATE_COMMIT_LOG &&
        statSync(join(root, '.git'), { throwIfNoEntry: false })?.isDirectory()
      )
        env.ULTIMATE_COMMIT_LOG = log
      else delete env.ULTIMATE_COMMIT_LOG
      // Pass on this process's own git config entries the hooks were numbered after, then trust the mounted folders
      // (owned by another user inside) and commit as Ultimate does here.
      let count = Number(env.GIT_CONFIG_COUNT ?? 0)
      for (let index = 0; index < Number(process.env.GIT_CONFIG_COUNT ?? 0); index++)
        for (const part of ['KEY', 'VALUE'])
          env[`GIT_CONFIG_${part}_${index}`] ??= process.env[`GIT_CONFIG_${part}_${index}`] ?? ''
      const config: [string, string][] = [['safe.directory', '*']]
      for (const key of ['user.name', 'user.email']) {
        const value = await git(root, 'config', key).catch(() => '')
        if (value) config.push([key, value])
      }
      for (const [key, value] of config) {
        env[`GIT_CONFIG_KEY_${count}`] = key
        env[`GIT_CONFIG_VALUE_${count++}`] = value
      }
      env.GIT_CONFIG_COUNT = String(count)
      return {
        ...execution,
        command: containerCommand(execution, root, container.id, env),
        env: env.ULTIMATE_COMMIT_LOG ? { ULTIMATE_COMMIT_LOG: log } : {},
      }
    },
    async status() {
      const config = configPath(root)
      if (!config) return { state: 'none', ports: [] }
      if (self.starting) return { state: 'starting', config, ports: [] }
      try {
        const container = await find(root)
        if (!container?.running)
          return self.error
            ? { state: 'error', config, ports: [], hint: self.error }
            : { state: 'stopped', config, ports: [] }
        return {
          state: 'running',
          config,
          container: container.name,
          ports: await ports(container),
          ...(await hintFor(container)),
        }
      } catch (error) {
        return { state: 'error', config, ports: [], hint: failure(error) }
      }
    },
    async start() {
      if (!configPath(root)) throw new Error('This project has no .devcontainer/devcontainer.json')
      // A failed start shows in the status it returns.
      await running().catch(() => undefined)
      return self.status()
    },
    async stop() {
      const container = await find(root)
      if (container?.running) {
        if (container.project) await docker('compose', '-p', container.project, 'stop')
        else await docker('stop', container.id)
      }
      self.error = undefined
      return self.status()
    },
  }
  states.set(host, self)
  host.implement(Shell, { prepare: (execution) => self.prepare(execution) })

  const dockerHost = /^tcp:\/\/([^:/]+)/.exec(process.env.DOCKER_HOST ?? '')?.[1] ?? 'localhost'
  return defineExtension({
    name: 'containers',
    sections: [
      section('project_container', () =>
        configPath(root)
          ? `Bash in ${root} and its worktrees runs inside the project's dev container (${relative(root, configPath(root)!)}), started on first use: install, build, test and run servers with bash as usual; they use the container's tools and its own node_modules or virtualenv. read, write and edit act on the same files. A server the container publishes on port N opens for the user at http://localhost:N and for your browser tools at http://${dockerHost}:N; a server must listen on 0.0.0.0, not 127.0.0.1. The containers status-line item shows what runs and starts or stops it.`
          : undefined,
      ),
    ],
  })
}
