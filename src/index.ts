// Entry point. Wires the Discord client to its events, registers
// the cron schedule, and starts the gateway connection.

import { Client, GatewayIntentBits, Events } from 'discord.js'
import cron from 'node-cron'
import { env } from './env.js'
import { log } from './lib/log.js'
import { onReady } from './events/ready.js'
import { onInteractionCreate } from './events/interactionCreate.js'
import { onGuildMemberAdd } from './events/guildMemberAdd.js'
import { runWeeklyPoll } from './jobs/weekly-poll.js'
import { resumePolls } from './jobs/poll-close.js'

const client = new Client({
  // Poll close is timer-driven (jobs/poll-close.ts), so no poll-vote
  // events are needed. GuildMembers (privileged) drives the linked
  // role on join; it must also be enabled in the Developer Portal.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  // Nothing pings unless a send opts in (see lib/duel-alert.ts).
  allowedMentions: { parse: [] },
})

client.once(Events.ClientReady, (c) => {
  onReady(c)

  // Post results for polls that ended while we were down, and
  // re-arm close timers for polls still open.
  resumePolls(c).catch((err) => log.error('poll resume threw', err))

  // Schedule the weekly poll. node-cron uses the timezone option
  // to interpret the cron string. Default: Sunday 18:00 in the
  // configured tz (America/New_York unless overridden).
  if (!cron.validate(env.weeklyPollCron)) {
    log.error(`invalid WEEKLY_POLL_CRON: "${env.weeklyPollCron}"`)
    return
  }
  cron.schedule(
    env.weeklyPollCron,
    () => {
      runWeeklyPoll(c).catch((err) => log.error('weekly poll threw', err))
    },
    { timezone: env.weeklyPollTz },
  )
  log.info(`weekly poll scheduled // ${env.weeklyPollCron} ${env.weeklyPollTz}`)
})

client.on(Events.InteractionCreate, onInteractionCreate)
client.on(Events.GuildMemberAdd, (member) => {
  onGuildMemberAdd(member).catch((err) => log.error('guildMemberAdd threw', err))
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

log.info('booting...')
client.login(env.discordBotToken).catch((err) => {
  log.error('failed to log in', err)
  process.exit(1)
})
