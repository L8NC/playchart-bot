// Reports server count and slash command usage to PlayChart's admin dashboard.
// Uses its own BOT_STATS_SECRET, separate from PLAYCHART_API_KEY.

import type { Client } from 'discord.js'
import { env } from '../env.js'
import { log } from './log.js'
import { restoreCommandCounts, takeCommandCounts } from './command-stats.js'

const FIRST_HEARTBEAT_DELAY_MS = 60_000
const REQUEST_TIMEOUT_MS = 10_000
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_INTERVAL_MINUTES = 60

// Retrying these can't succeed, so the batch is dropped.
const DROP_STATUSES = new Set([400, 401, 413])

// Last successful send, or process start.
let periodStart = new Date()

function intervalMs(): number {
  const minutes = Number(env.botStatsIntervalMinutes)
  const valid = Number.isFinite(minutes) && minutes > 0
  return (valid ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000
}

function statsUrl(): string | null {
  if (!env.botStatsSecret || !env.playchartApiBase) return null
  try {
    return `${new URL(env.playchartApiBase).origin}/api/internal/bot-stats`
  } catch {
    return null
  }
}

export function startStatsHeartbeat(client: Client<true>): void {
  const url = statsUrl()
  if (!url) {
    log.warn('stats heartbeat disabled // BOT_STATS_SECRET or a valid PLAYCHART_API_BASE is missing')
    return
  }

  const every = intervalMs()
  const tick = async () => {
    try {
      await sendHeartbeat(client, url)
    } catch (err) {
      log.error('stats heartbeat failed unexpectedly', err)
    }
    setTimeout(tick, every)
  }
  setTimeout(tick, FIRST_HEARTBEAT_DELAY_MS)
}

async function sendHeartbeat(client: Client<true>, url: string): Promise<void> {
  const periodEnd = new Date()
  if (periodEnd.getTime() - periodStart.getTime() > MAX_WINDOW_MS) {
    periodStart = new Date(periodEnd.getTime() - MAX_WINDOW_MS)
  }
  if (periodEnd.getTime() <= periodStart.getTime()) return

  const batch = takeCommandCounts()
  const body = JSON.stringify({
    bot: 'playchart-bot',
    guildCount: client.guilds.cache.size,
    commandCounts: Object.fromEntries(batch),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
  })

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.botStatsSecret}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    restoreCommandCounts(batch)
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network error'
    log.warn(`stats heartbeat ${reason} // will retry next interval`)
    return
  }

  if (res.status === 204) {
    periodStart = periodEnd
    log.info(`stats heartbeat sent // ${client.guilds.cache.size} guild(s)`)
    return
  }

  const code = await errorCode(res)
  if (DROP_STATUSES.has(res.status)) {
    periodStart = periodEnd
    log.error(`stats heartbeat rejected // ${res.status} ${code} // batch dropped`)
    return
  }

  restoreCommandCounts(batch)
  log.warn(`stats heartbeat -> ${res.status} ${code} // will retry next interval`)
}

async function errorCode(res: Response): Promise<string> {
  try {
    const parsed = (await res.json()) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : 'unknown_error'
  } catch {
    return 'unknown_error'
  }
}
