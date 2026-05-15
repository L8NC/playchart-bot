// Small logger. Outputs in the // MESSAGE // format from the brand voice.
// If we ever need structured logs, swap to pino. For now this reads right
// in Railway's log viewer and that's enough.

function ts(): string {
  return new Date().toISOString()
}

export const log = {
  info(msg: string): void {
    console.log(`${ts()} // ${msg}`)
  },
  warn(msg: string): void {
    console.warn(`${ts()} // WARN // ${msg}`)
  },
  error(msg: string, err?: unknown): void {
    console.error(`${ts()} // ERROR // ${msg}`)
    if (err instanceof Error) {
      console.error(err.stack ?? err.message)
    } else if (err !== undefined) {
      console.error(err)
    }
  },
}
