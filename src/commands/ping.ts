// Sanity-check command. If /ping works, the whole pipeline works:
// command registered, gateway connected, interaction routed, reply sent.
// Keep this command forever — it's the smoke test.

import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js'

export const ping = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is alive.'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const sent = await interaction.reply({
      content: '// PING //',
      flags: MessageFlags.Ephemeral,
      withResponse: true,
    })
    const replyTs = sent.resource?.message?.createdTimestamp ?? Date.now()
    const roundtrip = replyTs - interaction.createdTimestamp
    const gateway = interaction.client.ws.ping
    await interaction.editReply(
      `// PONG // rt ${roundtrip}ms / ws ${Math.round(gateway)}ms`,
    )
  },
}
