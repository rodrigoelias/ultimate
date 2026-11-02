/**
 * Containers in the browser: whether the project's dev container runs, what it publishes, and the actions that start
 * and stop it. Browser-safe.
 */
import { actionRef } from '../../shared/extension-api.ts'

/** A port the project's containers publish: `host` opens at http://localhost:<host>. */
export type Port = { service: string; container: number; host: number }

export type Status = {
  /** `none`: the project has no `.devcontainer/devcontainer.json`, so its bash runs here as usual. */
  state: 'none' | 'stopped' | 'starting' | 'running' | 'error'
  /** The project's devcontainer.json. */
  config?: string
  /** The container bash runs in. */
  container?: string
  ports: Port[]
  /** What failed, or what to fix (an old git in the container). */
  hint?: string
}

/** No arguments → the project's dev container status. */
export const StatusAction = actionRef<null, Status>('containers', 'status')
/** No arguments → starts (or first builds) the dev container, then its status. */
export const StartAction = actionRef<null, Status>('containers', 'start')
/** No arguments → stops the dev container and the services started with it, then its status. */
export const StopAction = actionRef<null, Status>('containers', 'stop')
