/**
 * Coding tools: Pi's read, write, edit and bash tools and how the transcript shows them. Core tier; other extensions
 * can move bash calls elsewhere through the `coding-tools.shell` extension point.
 */
import type { BashExecution } from '@earendil-works/pi-durable/tools'
import { defineApi } from '../../shared/extension-api.ts'

export { Committed } from './refs.ts'
export const tier = 'core'

export type ShellService = {
  /**
   * Where bash call `execution` runs: the same execution to run it here, or one with a new command, cwd or environment,
   * such as a command that runs it inside a container. Its environment already carries the commit hooks; a returned
   * `ULTIMATE_COMMIT_LOG` moves their log to a path the command can write, and the call reads it from there. `signal`
   * aborts when the call is cancelled or interrupted: stop waiting then.
   */
  prepare(execution: BashExecution, signal?: AbortSignal): Promise<BashExecution>
}
/** The extension point bash calls run through; the optional containers extension provides it. */
export const Shell = defineApi<ShellService>()('coding-tools.shell')
