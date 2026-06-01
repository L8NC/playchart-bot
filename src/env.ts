// Validates env vars on startup. If anything required is missing,
// the process exits immediately with a clear message. Deliberate —
// config errors should be obvious at boot, not 30 seconds in
// when some command hits an undefined.
//
// Twitter integration (Buffer + Cloudinary) is OPT-IN. The bot will
// boot fine without those vars set; the Sunday cron will just skip
// the tweet step. This means we can ship the Discord bot without
// blocking on Twitter setup, and Twitter is a separate concern.

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

// True only if ALL the Twitter integration vars are populated.
// One bad var = whole feature disabled, fail-closed.
function readTwitterEnabled(): boolean {
  const keys = [
    'BUFFER_API_TOKEN',
    'BUFFER_TWITTER_CHANNEL_ID',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ]
  return keys.every((k) => {
    const v = process.env[k]
    return v && v.trim() !== ''
  })
}

export const env = {
  // ─── Discord ───
  discordBotToken: required('DISCORD_BOT_TOKEN'),
  discordApplicationId: required('DISCORD_APPLICATION_ID'),
  discordGuildId: optional('DISCORD_GUILD_ID', ''),
  discordVersusChannelId: required('DISCORD_VERSUS_CHANNEL_ID'),
  discordAdminUserId: optional('DISCORD_ADMIN_USER_ID', ''),

  // ─── Playchart API ───
  playchartApiBase: required('PLAYCHART_API_BASE'),
  playchartApiKey: required('PLAYCHART_API_KEY'),

  // ─── Scheduling — Discord poll ───
  weeklyPollCron: optional('WEEKLY_POLL_CRON', '0 18 * * 0'),
  weeklyPollTz: optional('WEEKLY_POLL_TZ', 'America/New_York'),

  // ─── Scheduling — Tweet ───
  // When Buffer should publish the tweet. Default: Monday 08:00 in
  // the same TZ as the poll. This is the *scheduled publish time*,
  // not when the bot calls Buffer — the bot calls Buffer immediately
  // when the Discord poll fires, and Buffer holds the post until this.
  tweetScheduleCron: optional('TWEET_SCHEDULE_CRON', '0 8 * * 1'),
  tweetScheduleTz: optional('TWEET_SCHEDULE_TZ', 'America/New_York'),

  // ─── Twitter integration (optional) ───
  bufferApiToken: optional('BUFFER_API_TOKEN', ''),
  bufferTwitterChannelId: optional('BUFFER_TWITTER_CHANNEL_ID', ''),
  cloudinaryCloudName: optional('CLOUDINARY_CLOUD_NAME', ''),
  cloudinaryApiKey: optional('CLOUDINARY_API_KEY', ''),
  cloudinaryApiSecret: optional('CLOUDINARY_API_SECRET', ''),

  isTwitterEnabled: readTwitterEnabled(),

  // ─── Runtime ───
  isDev: optional('NODE_ENV', 'development') === 'development',
} as const
