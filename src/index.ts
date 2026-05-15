// Entry point. Wires the Discord client to its events and
// starts the gateway connection.

import { Client, GatewayIntentBits, Events } from 'discord.js'
import { env } from './env.js'
import { log } from './lib/log.js'
import { onReady } from './events/ready.js'
import { onInteractionCreate } from './events/interactionCreate.js'

const client = new Client({
  // Guilds is the only intent we need right now. Slash commands work
  // without privileged intents. We'll add MessageContent / GuildMembers
  // only when a feature genuinely requires them.
  intents: [GatewayIntentBits.Guilds],
})

client.once(Events.ClientReady, onReady)
client.on(Events.InteractionCreate, onInteractionCreate)

// Don't crash on a single unhandled promise rejection — log it loudly
// and stay up. Discord disconnects are common; we want graceful recovery.
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

log.info('booting...')
client.login(env.discordBotToken).catch((err) => {
  log.error('failed to log in', err)
  process.exit(1)
})
