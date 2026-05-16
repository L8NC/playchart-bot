// /link <code> — Consume a one-time link code generated at
// playchart.gg/settings/discord. All replies are ephemeral —
// the code shouldn't be visible to other users, and neither
// should "link succeeded" since it reveals the Playchart username.

import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { api, PlaychartApiError } from '../lib/api.js'
import { log } from '../lib/log.js'

const SETTINGS_URL = 'https://playchart.gg/settings/discord'

// Normalize what the user typed. They might paste with extra spaces,
// lowercase the prefix, or copy a trailing newline. The codes on the
// web side are uppercase with a PC- prefix. Forgive variations.
function normalize(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export const link = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord to your Playchart account.')
    .addStringOption((opt) =>
      opt
        .setName('code')
        .setDescription('The code from playchart.gg/settings/discord')
        .setRequired(true)
        .setMinLength(4)
        .setMaxLength(20),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const rawCode = interaction.options.getString('code', true)
    const code = normalize(rawCode)

    // Defer ephemerally — the API call takes ~200-500ms and we want
    // to be safe under Discord's 3-second initial-response limit.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })

    try {
      const result = await api.consumeLinkCode({
        code,
        discordId: interaction.user.id,
        discordUsername: interaction.user.username,
      })

      log.info(
        `link ok // discord ${interaction.user.id} (${interaction.user.username}) -> playchart ${result.username}`,
      )

      await interaction.editReply(
        [
          `// LINKED // playchart.gg/${result.username}`,
          ``,
          `Your charts and matchups now connect to this Discord.`,
          `Try \`/chart\` to see what you've built.`,
        ].join('\n'),
      )
    } catch (err) {
      if (err instanceof PlaychartApiError) {
        await interaction.editReply(messageForError(err.code))
        return
      }
      // Network failure, JSON parse error, anything else.
      log.error('link command — unexpected error', err)
      await interaction.editReply(
        [
          `// ERROR // something broke on our end.`,
          `Try again in a minute. If it keeps failing, ping a mod.`,
        ].join('\n'),
      )
    }
  },
}

// One message per error code, written in voice.
// Each tells the user (a) what happened, (b) what to do next.
function messageForError(code: string): string {
  switch (code) {
    case 'code_not_found':
      return [
        `// NO MATCH // that code doesn't exist.`,
        ``,
        `Double-check what you pasted. Codes look like \`PC-XXXXXX\`.`,
        `Generate a fresh one at ${SETTINGS_URL}`,
      ].join('\n')

    case 'code_expired':
      return [
        `// EXPIRED // that code timed out.`,
        ``,
        `Codes last about 30 seconds. Grab a new one at ${SETTINGS_URL}`,
        `and run \`/link\` right after.`,
      ].join('\n')

    case 'code_already_used':
      return [
        `// USED // that code has already been redeemed.`,
        ``,
        `If that wasn't you, head to ${SETTINGS_URL} and check your account.`,
        `If it was — you might already be linked. Try \`/chart\`.`,
      ].join('\n')

    case 'discord_already_linked':
      return [
        `// CONFLICT // there's already a link involving these accounts.`,
        ``,
        `Either this Discord is on another Playchart account,`,
        `or this Playchart account is already linked to a different Discord.`,
        `Visit ${SETTINGS_URL} to see your current link or unlink first.`,
      ].join('\n')

    case 'unauthorized':
      // This should never reach a user — it means the bot's API key
      // is bad. Treat it as an outage on our end, not user error.
      return [
        `// ERROR // the bot can't reach Playchart right now.`,
        `Ping a mod. (auth)`,
      ].join('\n')

    case 'invalid_input':
    case 'invalid_json':
      // Also shouldn't reach a user — bot side built the request.
      return [
        `// ERROR // something's wrong with the request shape.`,
        `Ping a mod. (input)`,
      ].join('\n')

    default:
      return [
        `// ERROR // unexpected response from Playchart (${code}).`,
        `Ping a mod.`,
      ].join('\n')
  }
}
