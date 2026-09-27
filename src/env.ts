// Validates env vars on startup. If anything required is missing,
// the process exits immediately with a clear message. Deliberate —
// config errors should be obvious at boot, not 30 seconds in
// when some command hits an undefined.

import 'dotenv/config'

function required(key: string): string {
  const value = process.env[key]
  if (!value || value.trim() === '') {
    console.error(`// CONFIG ERROR // missing required env var: ${key}`)
    process.exit(1)
  }
  return value
}

function optional(key: string, fallback: string): string {
  const value = process.env[key]
  return value && value.trim() !== '' ? value : fallback
}

function readPollDurationHours(): number {
  const parsed = Number.parseInt(optional('WEEKLY_POLL_DURATION_HOURS', '96'), 10)
  if (!Number.isFinite(parsed)) return 96
  return Math.min(768, Math.max(1, parsed))
}

export const env = {
  // ─── Discord ───
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordApplicationId: required('DISCORD_APPLICATION_ID'),
  discordGuildId: optional('DISCORD_GUILD_ID', ''),
  discordVersusChannelId: required('DISCORD_VERSUS_CHANNEL_ID'),
  // Role allowed to run admin commands (/poll-now, /announce).
  // Empty = those commands stay locked.
  discordFounderRoleId: optional('DISCORD_FOUNDER_ROLE_ID', ''),
  // Role pinged when a duel opens and when it closes. Empty = no ping.
  discordDuelAlertRoleId: optional('DISCORD_DUEL_ALERT_ROLE_ID', ''),
  // Role given on join to members with a linked PlayChart account.
  // Empty = skip. Only applied in DISCORD_GUILD_ID.
  linkedRoleId: optional('LINKED_ROLE_ID', ''),

  // ─── Playchart API ───
  playchartApiBase: required('PLAYCHART_API_BASE'),
  playchartApiKey: required('PLAYCHART_API_KEY'),

  // ─── Scheduling — Discord poll ───
  weeklyPollCron: optional('WEEKLY_POLL_CRON', '0 18 * * 0'),
  weeklyPollTz: optional('WEEKLY_POLL_TZ', 'America/New_York'),
  // How long the poll stays open. Default 96 (4 days). Set to 1 to
  // test the close/result flow in a test channel. Discord caps at 768.
  weeklyPollDurationHours: readPollDurationHours(),

  // ─── Stats heartbeat (optional) ───
  // Hourly server count and command usage for PlayChart's admin dashboard.
  // Without the secret the bot runs normally and skips heartbeats.
  botStatsSecret: optional('BOT_STATS_SECRET', ''),
  botStatsIntervalMinutes: optional('BOT_STATS_INTERVAL_MINUTES', '60'),

  // ─── Runtime ───
  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
