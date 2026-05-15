// Fires once the gateway connection is established.
// First successful boot signal — if this never prints, the bot
// is failing to connect (usually bad token).

import type { Client } from 'discord.js'
import { log } from '../lib/log.js'

export function onReady(client: Client<true>): void {
  log.info(`READY // logged in as ${client.user.tag} // ${client.guilds.cache.size} guild(s)`)
}
