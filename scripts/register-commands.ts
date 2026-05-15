// One-time deploy script. Pushes the slash command definitions
// to Discord so the commands show up in your server.
//
// Run this:
//   - After adding or changing any command's `data`
//   - Once per new environment (dev guild, prod globally)
//
// Discord stores command definitions on their side — you do NOT
// re-register on every bot boot. That would rate-limit you fast.
//
// Usage:
//   npm run register
//
// If DISCORD_GUILD_ID is set: registers commands to that guild (instant).
// If DISCORD_GUILD_ID is empty: registers globally (up to 1hr propagation).

import { REST, Routes } from 'discord.js'
import { env } from '../src/env.js'
import { commands } from '../src/commands/index.js'
import { log } from '../src/lib/log.js'

const rest = new REST({ version: '10' }).setToken(env.discordBotToken)

const body = commands.map((c) => c.data.toJSON())

async function main() {
  log.info(`registering ${body.length} command(s)...`)

  if (env.discordGuildId) {
    // Guild-scoped (instant propagation, dev workflow)
    const route = Routes.applicationGuildCommands(
      env.discordApplicationId,
      env.discordGuildId,
    )
    await rest.put(route, { body })
    log.info(`registered to guild ${env.discordGuildId}`)
  } else {
    // Global (slower propagation, prod workflow)
    const route = Routes.applicationCommands(env.discordApplicationId)
    await rest.put(route, { body })
    log.info('registered globally (up to 1hr to appear in all servers)')
  }
}

main().catch((err) => {
  log.error('registration failed', err)
  process.exit(1)
})
