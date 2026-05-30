// Routes incoming interactions to their handlers.
// Handles:
//   - Chat-input slash commands → command.execute()
//   - Autocomplete → command.autocomplete()
//   - Modal submits → routed by custom_id prefix
//   - Buttons → routed by custom_id prefix

import type { Interaction } from 'discord.js'
import { MessageFlags } from 'discord.js'
import { commandByName } from '../commands/index.js'
import { PlaychartApiError } from '../lib/api.js'
import { log } from '../lib/log.js'
import {
  handleAnnounceModalSubmit,
  handleAnnounceButton,
} from '../commands/announce.js'

export async function onInteractionCreate(interaction: Interaction): Promise<void> {
  // Autocomplete — silent failure, no user-facing error.
  if (interaction.isAutocomplete()) {
    const command = commandByName.get(interaction.commandName)
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

  // Modal submits — route by custom_id prefix.
  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith('announce_modal:')) {
        await handleAnnounceModalSubmit(interaction)
      }
    } catch (err) {
      log.error('modal submit threw', err)
      await interaction
        .reply({
          content: '// ERROR // something broke processing your submission.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
    }
    return
  }

  // Buttons — route by custom_id prefix.
  if (interaction.isButton()) {
    try {
      if (
        interaction.customId.startsWith('announce_post:') ||
        interaction.customId.startsWith('announce_discard:')
      ) {
        await handleAnnounceButton(interaction)
      }
    } catch (err) {
      log.error('button click threw', err)
      await interaction
        .reply({
          content: '// ERROR // something broke handling that click.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {})
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
