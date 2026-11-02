import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  configPath,
  containerCommand,
  parsePorts,
  worktreesFolder,
} from '../extensions/containers/server.ts'
import { removeTemp, temp } from './helpers.ts'

it('finds a project dev container config only where the Dev Containers CLI looks', async () => {
  const root = await temp('ultimate-containers-')
  try {
    expect(configPath(root)).toBeUndefined()
    await mkdir(join(root, '.devcontainer'))
    await writeFile(join(root, '.devcontainer/devcontainer.json'), '{}')
    expect(configPath(root)).toBe(join(root, '.devcontainer/devcontainer.json'))
  } finally {
    await removeTemp(root)
  }
})

it('mounts the folder isolates.worktree.path puts checkouts in, when the container can share it', () => {
  const settings = (path: string) => ({ isolates: { worktree: { path } } })
  expect(worktreesFolder(settings('/projects/.ultimate-worktrees/my-app/{name}'))).toBe(
    '/projects/.ultimate-worktrees/my-app',
  )
  expect(worktreesFolder(settings('/projects/trees/my-app-{name}'))).toBe('/projects/trees')
  expect(worktreesFolder(settings('~/trees/{name}'))).toBeUndefined()
  expect(worktreesFolder({})).toBeUndefined()
})

it('reads published ports once each from docker ps', () => {
  expect(
    parsePorts(
      'backend',
      '0.0.0.0:3010->3210/tcp, [::]:3010->3210/tcp, 3211/tcp, 0.0.0.0:3011->3211/tcp',
    ),
  ).toEqual([
    { service: 'backend', host: 3010, container: 3210 },
    { service: 'backend', host: 3011, container: 3211 },
  ])
})

it('runs a call in the container with its own env, cwd and command as single words', () => {
  const command = containerCommand(
    { command: `echo "it's" $HOME`, cwd: '/projects/my-app' },
    '/projects/my-app',
    'abc123',
    { GIT_CONFIG_COUNT: '1', ULTIMATE_COMMIT_LOG: '/projects/my-app/.git/log' },
  )
  expect(command).toMatch(/\n'.+node' '.+devcontainer\.js' 'exec' '--workspace-folder' /)
  expect(command).toContain(
    `'--container-id' 'abc123' '--remote-env' 'GIT_CONFIG_COUNT=1' '--remote-env' 'ULTIMATE_COMMIT_LOG=/projects/my-app/.git/log' 'sh' '-c'`,
  )
  expect(command).toContain(`'-' '/projects/my-app' 'echo "it'\\''s" $HOME'`)
  // The client's stdin stays open until the call ends or its process group is killed; the container then kills it.
  expect(command).toMatch(/^exec 3< <\(exec sleep \d+ 2>\/dev\/null\); s=\$!\n/)
  expect(command).toMatch(/ <&3 3<&-; r=\$\?\nkill \$s; exit \$r$/)
})
