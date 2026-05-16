// /versus <a> <b>
//
// Show the head-to-head record between two games across all
// Playchart users. Both arguments use autocomplete against
// /api/bot/games/search.

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js'
import { api, PlaychartApiError, type GameRef } from '../lib/api.js'
import { log } from '../lib/log.js'

const ACCENT = 0xe8a838

export const versus = {
  data: new SlashCommandBuilder()
    .setName('versus')
    .setDescription('Head-to-head record between two games.')
    .addStringOption((opt) =>
      opt
        .setName('a')
        .setDescription('First game')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('b')
        .setDescription('Second game')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  // The slash command system delivers the chosen value as a string —
  // we pass the game ID as the value behind a human-readable label.
  // So `interaction.options.getString('a')` returns "1942", we parse it.
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const aRaw = interaction.options.getString('a', true)
    const bRaw = interaction.options.getString('b', true)

    const aId = Number(aRaw)
    const bId = Number(bRaw)

    // Defensive — if autocomplete wasn't used (user typed a value
    // directly without selecting from the dropdown), we won't have
    // a valid game ID. Tell them to use the suggestions.
    if (!Number.isFinite(aId) || !Number.isFinite(bId)) {
      await interaction.reply({
        content: [
          `// PICK FROM THE LIST //`,
          `Type the game name and select from the dropdown — `,
          `freeform text won't resolve to a game.`,
        ].join('\n'),
        ephemeral: true,
      })
      return
    }

    if (aId === bId) {
      await interaction.reply({
        content: `// SAME GAME // a game can't fight itself.`,
        ephemeral: true,
      })
      return
    }

    await interaction.deferReply()

    try {
      const result = await api.versus(aId, bId)

      if (result.totalMatchups === 0) {
        const embed = new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle(`${result.gameA.name} vs ${result.gameB.name}`)
          .setDescription(
            [
              `// NO HISTORY //`,
              ``,
              `These two haven't been matched up yet.`,
              `Vote at [playchart.gg](https://www.playchart.gg) to make it happen.`,
            ].join('\n'),
          )
        await interaction.editReply({ embeds: [embed] })
        return
      }

      const embed = renderVersusEmbed(result)
      await interaction.editReply({ embeds: [embed] })
    } catch (err) {
      if (err instanceof PlaychartApiError) {
        await interaction.editReply({
          content: messageForError(err.code),
        })
        return
      }
      log.error('versus command — unexpected error', err)
      await interaction.editReply({
        content: '// ERROR // something broke. Try again in a minute.',
      })
    }
  },

  // Autocomplete handler. Discord calls this as the user types.
  // We hit BP's game search endpoint and return up to 25 results.
  // The `value` of each choice is the game ID (as a string) so the
  // command handler can look it up directly.
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true)
    const query = focused.value.trim()

    if (query.length < 2) {
      await interaction.respond([])
      return
    }

    try {
      const result = await api.searchGames(query, 25)
      const choices = result.results.map((g) => ({
        name: formatChoiceLabel(g),
        value: String(g.gameId),
      }))
      await interaction.respond(choices)
    } catch (err) {
      // Autocomplete failures are silent — Discord shows an empty list
      // and the user moves on. Don't crash the typing flow.
      log.warn(`versus autocomplete failed: ${query}`)
      await interaction.respond([]).catch(() => {})
    }
  },
}

// ────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────

function renderVersusEmbed(
  data: Awaited<ReturnType<typeof api.versus>>,
): EmbedBuilder {
  const a = data.gameA
  const b = data.gameB
  const aPct = Math.round(data.gameAWinRate * 100)
  const bPct = 100 - aPct

  // Visual bar — proportional ASCII split. 20 chars wide.
  const bar = renderBar(aPct, 20)

  const winner =
    data.gameAWins > data.gameBWins
      ? a.name
      : data.gameBWins > data.gameAWins
        ? b.name
        : null

  const description = [
    `**${escapeMd(a.name)}** \`${aPct}%\` — \`${bPct}%\` **${escapeMd(b.name)}**`,
    ``,
    `\`${bar}\``,
    ``,
    winner
      ? `*${data.totalMatchups.toLocaleString()} matchups · ${escapeMd(winner)} ahead*`
      : `*${data.totalMatchups.toLocaleString()} matchups · dead even*`,
  ].join('\n')

  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`${a.name} vs ${b.name}`)
    .setURL(`https://www.playchart.gg`)
    .setDescription(description)
}

// "█████████░░░░░░░░░░░" — proportional split bar.
function renderBar(aPct: number, width: number): string {
  const aChars = Math.round((aPct / 100) * width)
  const bChars = width - aChars
  return '█'.repeat(aChars) + '░'.repeat(bChars)
}

function formatChoiceLabel(g: GameRef): string {
  // Discord caps choice name at 100 chars. Truncate game names safely.
  const year = g.releaseYear ? ` (${g.releaseYear})` : ''
  const base = `${g.name}${year}`
  return base.length > 100 ? base.slice(0, 97) + '...' : base
}

function escapeMd(s: string): string {
  return s.replace(/([\\*_`~\[\]()<>|])/g, '\\$1')
}

function messageForError(code: string): string {
  switch (code) {
    case 'game_not_found':
      return `// NOT FOUND // one of those games isn't in the database.`
    case 'unauthorized':
    case 'invalid_input':
      return `// ERROR // the bot can't reach Playchart right now. Ping a mod.`
    default:
      return `// ERROR // unexpected response (${code}). Ping a mod.`
  }
}
