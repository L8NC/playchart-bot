// /poll-now — Admin-only command that fires the weekly poll
// immediately. For testing the schedule logic without waiting
// 6 days. Restricted to the founder role (DISCORD_FOUNDER_ROLE_ID).

import {
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { runWeeklyPoll } from '../jobs/weekly-poll.js'
import { log } from '../lib/log.js'
import {
  FOUNDER_NOT_CONFIGURED,
  isFounder,
  isFounderConfigured,
} from '../lib/permissions.js'

export const pollNow = {
  data: new SlashCommandBuilder()
    .setName('poll-now')
    .setDescription('Admin only. Fires the weekly versus poll immediately.')
    // Hidden from members without Manage Server, like /announce.
    // isFounder() in execute() is the real gate.
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!isFounderConfigured()) {
      await interaction.reply({
        content: FOUNDER_NOT_CONFIGURED,
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (!isFounder(interaction)) {
      await interaction.reply({
        content: '// LOCKED // this one is admin-only.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    try {
      const result = await runWeeklyPoll(interaction.client, { force: true })
      if (result.status === 'busy') {
        await interaction.editReply('// BUSY // a poll run is already in progress.')
        return
      }
      if (result.status !== 'posted') {
        await interaction.editReply('// FAILED // see logs.')
        return
      }
      await interaction.editReply(`// POSTED // message ${result.message.id}`)
    } catch (err) {
      log.error('/poll-now threw', err)
      await interaction.editReply('// ERROR // something broke. See logs.')
    }
  },
}
