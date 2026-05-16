// Routes incoming interactions to their handlers.
// Handles:
//   - Chat-input slash commands → command.execute()
//   - Autocomplete → command.autocomplete()
// Buttons and select menus will be added when commands need them.

import type { Interaction } from 'discord.js'
import { MessageFlags } from 'discord.js'
import { commandByName } from '../commands/index.js'
import { PlaychartApiError } from '../lib/api.js'
import { log } from '../lib/log.js'

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  // Autocomplete — silent failure, no user-facing error.
  if (interaction.isAutocomplete()) {
    const command = commandByName.get(interaction.commandName)
    // Only some commands have autocomplete handlers; others just don't.
    if (command && 'autocomplete' in command && typeof command.autocomplete === 'function') {
      try {
        await command.autocomplete(interaction)
      } catch (err) {
        log.warn(`autocomplete ${interaction.commandName} failed`)
        await interaction.respond([]).catch(() => {})
      }
    } else {
      await interaction.respond([]).catch(() => {})
    }
    return
  }

  // Slash commands.
  if (!interaction.isChatInputCommand()) return

  const command = commandByName.get(interaction.commandName)
  if (!command) {
    log.warn(`unknown command: ${interaction.commandName}`)
    return
  }

  try {
    await command.execute(interaction)
  } catch (err) {
    log.error(`command ${interaction.commandName} threw`, err)

    const userMessage = err instanceof PlaychartApiError
      ? `// ERROR // ${err.code}`
      : '// ERROR // something broke'

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: userMessage }).catch(() => {})
    } else {
      await interaction
        .reply({ content: userMessage, flags: MessageFlags.Ephemeral })
        .catch(() => {})
    }
  }
}
