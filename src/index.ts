// Entry point. Wires the Discord client to its events, registers
// the cron schedule, and starts the gateway connection.

import { Client, GatewayIntentBits, Events } from 'discord.js'
import cron from 'node-cron'
import { env } from './env.js'
import { log } from './lib/log.js'
import { onReady } from './events/ready.js'
import { onInteractionCreate } from './events/interactionCreate.js'
import { registerPollEndedListener } from './events/messagePollVoteAdd.js'
import { runWeeklyPoll } from './jobs/weekly-poll.js'

const client = new Client({
  // Guilds + GuildMessagePolls. Polls is needed to receive
  // poll-vote events so we can post the result follow-up.
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessagePolls,
  ],
})

client.once(Events.ClientReady, (c) => {
  onReady(c)

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
registerPollEndedListener(client)

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

log.info('booting...')
client.login(env.discordBotToken).catch((err) => {
  log.error('failed to log in', err)
  process.exit(1)
})
