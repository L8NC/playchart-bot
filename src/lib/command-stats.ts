// In-memory slash command usage counter for the stats heartbeat.
// Only the top-level command name is kept: no user, guild, channel, or options.

const NAME_PATTERN = /^[a-z0-9-]{1,32}$/

let counts = new Map<string, number>()

export function recordCommand(name: string): void {
  if (!NAME_PATTERN.test(name)) return
  counts.set(name, (counts.get(name) ?? 0) + 1)
}

// Hands the current counts to the caller and starts a fresh map, so commands
// that run while a heartbeat is in flight land in the next batch.
export function takeCommandCounts(): Map<string, number> {
  const taken = counts
  counts = new Map()
  return taken
}

// Puts an unsent batch back after a retryable failure.
export function restoreCommandCounts(batch: Map<string, number>): void {
  for (const [name, count] of batch) {
    counts.set(name, (counts.get(name) ?? 0) + count)
  }
}
