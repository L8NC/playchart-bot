// Fires once the gateway connection is established.
// First successful boot signal — if this never prints, the bot
// is failing to connect (usually bad token).

import type { Client } from 'discord.js'
import { ActivityType } from 'discord.js'
import { log } from '../lib/log.js'

const STATUSES = [
  { text: 'Two games enter. One wins.', type: ActivityType.Watching },
  { text: 'you vote in #versus', type: ActivityType.Watching },
  { text: 'your chart build itself',     type: ActivityType.Watching },
  { text: 'playchart.gg',                type: ActivityType.Playing  },
] as const

export function onReady(client: Client<true>): void {
  log.info(`READY // logged in as ${client.user.tag} // ${client.guilds.cache.size} guild(s)`)

  // Set status immediately on boot, then rotate every 30 seconds.
  let i = 0
  const setStatus = () => {
    const s = STATUSES[i % STATUSES.length]
    client.user.setActivity(s.text, { type: s.type })
    i++
  }
  setStatus()
  setInterval(setStatus, 86_400_000)
}
