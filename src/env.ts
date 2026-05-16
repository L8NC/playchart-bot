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

export const env = {
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordApplicationId: required('DISCORD_APPLICATION_ID'),
  discordGuildId: optional('DISCORD_GUILD_ID', ''),
  discordVersusChannelId: required('DISCORD_VERSUS_CHANNEL_ID'),

  // Discord user ID of the bot admin (you). Restricts /poll-now to
  // a single person so nobody else can spam the weekly poll.
  discordAdminUserId: optional('DISCORD_ADMIN_USER_ID', ''),

  playchartApiBase: required('PLAYCHART_API_BASE'),
  playchartApiKey: required('PLAYCHART_API_KEY'),

  weeklyPollCron: optional('WEEKLY_POLL_CRON', '0 18 * * 0'),
  weeklyPollTz: optional('WEEKLY_POLL_TZ', 'America/New_York'),

  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
