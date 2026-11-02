import { ExternalLinkIcon, LoaderCircleIcon, PlayIcon, SquareIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { api, cn, defineWebExtension, errorMessage, events, useAction, useEvent } from '@/sdk'
import { StartAction, StatusAction, StopAction } from './refs.ts'
import type { Status } from './refs.ts'

const dot = (tone: string) => <span className={cn('size-1.5 rounded-full', tone)} />

const tones: Record<Status['state'], string> = {
  none: 'bg-muted-foreground/40',
  stopped: 'bg-muted-foreground/40',
  starting: 'bg-brand animate-pulse',
  running: 'bg-success',
  error: 'bg-warning',
}

const labels: Record<Status['state'], string> = {
  none: 'no dev container',
  stopped: 'stopped',
  starting: 'starting…',
  running: 'running',
  error: 'needs a fix',
}

/** What runs, where to open it, and the button that starts or stops it. */
function Details({ status, refetch }: { status: Status; refetch: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (ref: typeof StartAction) => {
    setBusy(true)
    setError(undefined)
    try {
      await api.action(ref)
      await refetch()
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const running = status.state === 'running'
  const starting = status.state === 'starting' || (busy && !running)
  return (
    <section className="px-3 pt-3 pb-3.5 font-sans">
      <div className="flex items-center gap-2 section-label">
        Dev container
        <span className="ml-auto flex items-center gap-1.5 normal-case">
          {dot(tones[starting ? 'starting' : status.state])}
          {labels[starting ? 'starting' : status.state]}
        </span>
      </div>
      {status.container && (
        <p className="mt-2 font-mono text-[11.5px] text-muted-foreground">{status.container}</p>
      )}
      {running && status.ports.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {status.ports.map((port) => (
            <li className="flex items-center gap-2 text-[12.5px]" key={port.host}>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{port.service}</span>
              <a
                className="inline-flex items-center gap-1 font-mono text-[12px] text-brand outline-none hover:underline focus-visible:underline"
                href={`http://localhost:${port.host}`}
                rel="noreferrer"
                target="_blank"
              >
                localhost:{port.host}
                <ExternalLinkIcon className="size-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {running && status.ports.length === 0 && (
        <p className="mt-2 text-[12px] text-muted-foreground">Publishes no ports.</p>
      )}
      {status.state === 'stopped' && !busy && (
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          Starts with the next bash command in this project, or here.
        </p>
      )}
      {(status.hint || error) && (
        <p
          className={cn(
            'mt-2 line-clamp-6 leading-snug break-words',
            status.state === 'error' || error
              ? 'font-mono text-[11px] text-error/85'
              : 'text-[12px] text-warning',
          )}
          title={error ?? status.hint}
        >
          {error ?? status.hint}
        </p>
      )}
      <Button
        className="mt-3 h-7 gap-1.5 px-2 font-mono text-[11.5px]"
        disabled={busy || status.state === 'starting'}
        onClick={() => void run(running ? StopAction : StartAction)}
        size="sm"
        variant="outline"
      >
        {busy || starting ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : running ? (
          <SquareIcon className="size-3.5" />
        ) : (
          <PlayIcon className="size-3.5" />
        )}
        {running ? 'Stop' : 'Start'}
      </Button>
    </section>
  )
}

/**
 * "container" in the status line while the project has a dev container: green while it runs, grey while stopped,
 * amber when it needs a fix. A click opens the details above it.
 */
function Indicator() {
  // Failures show where the status does, not as notices: the status line reads it on every page.
  const status = useAction(StatusAction, null, { onError: () => {} })
  const [open, setOpen] = useState(false)
  useEvent('containers:open', () => setOpen(true))
  const data = status.data
  if (!data || data.state === 'none') return null
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next)
        // oxlint-disable-next-line typescript/no-floating-promises -- useAction reports failures and resolves undefined rather than rejecting.
        if (next) void status.refetch()
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            '-mx-1 flex items-center gap-1.5 rounded-sm px-1 transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground',
            data.state === 'error' && 'text-warning',
          )}
          data-container={data.state}
          title={`Dev container ${labels[data.state]}`}
          type="button"
        >
          {dot(tones[data.state])}
          container
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-1rem)] p-0" side="top">
        <Details refetch={status.refetch} status={data} />
      </PopoverContent>
    </Popover>
  )
}

export default defineWebExtension({
  slots: { 'statusline.right': [Indicator] },
  commands: [
    {
      id: 'containers.panel',
      title: 'Dev container…',
      run: () => events.emit('containers:open', undefined),
    },
  ],
})
