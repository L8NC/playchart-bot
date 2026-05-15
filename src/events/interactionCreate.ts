// Routes incoming interactions (slash commands, buttons, autocompletes)
// to their handlers. Right now we only handle chat-input commands;
// buttons and autocomplete get added when the commands that need them
// get built.

import type { Interaction } from 'discord.js'
import { MessageFlags } from 'discord.js'
import { commandByName } from '../commands/index.js'
import { PlaychartApiError } from '../lib/api.js'
import { log } from '../lib/log.js'

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return

  const command = commandByName.get(interaction.commandName)
  if (!command) {
    log.warn(`unknown command: ${interaction.commandName}`)
    return
  }

  try {
    await command.execute(interaction)
  } catch (err) {
    // Don't leak stack traces to users. Log everything, reply with
    // a brand-voice failure message.
    log.error(`command ${interaction.commandName} threw`, err)

    const userMessage = err instanceof PlaychartApiError
      ? `// ERROR // ${err.code}`
      : '// ERROR // something broke'

    // If we already replied/deferred, edit. Otherwise reply ephemerally.
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: userMessage }).catch(() => {})
    } else {
      await interaction
        .reply({ content: userMessage, flags: MessageFlags.Ephemeral })
        .catch(() => {})
    }
  }
}
