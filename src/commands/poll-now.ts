// /poll-now — Admin-only command that fires the weekly poll
// immediately. For testing the schedule logic without waiting
// 6 days. Restricted by Discord user ID (env var).

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { env } from '../env.js'
import { runWeeklyPoll } from '../jobs/weekly-poll.js'
import { log } from '../lib/log.js'

export const pollNow = {
  data: new SlashCommandBuilder()
    .setName('poll-now')
    .setDescription('Admin only. Fires the weekly versus poll immediately.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!env.discordAdminUserId) {
      await interaction.reply({
        content: '// LOCKED // admin user not configured.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (interaction.user.id !== env.discordAdminUserId) {
      await interaction.reply({
        content: '// LOCKED // this one is admin-only.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    try {
      const posted = await runWeeklyPoll(interaction.client, { force: true })
      if (!posted) {
        await interaction.editReply('// FAILED // see logs.')
        return
      }
      await interaction.editReply(`// POSTED // message ${posted.id}`)
    } catch (err) {
      log.error('/poll-now threw', err)
      await interaction.editReply('// ERROR // something broke. See logs.')
    }
  },
}
