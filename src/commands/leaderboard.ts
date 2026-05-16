// /leaderboard [genre] [top]
//
// Show the global top N games. Genre filter optional.
// Genre choices are hardcoded — there's no genre-search endpoint,
// and the genre list is small enough that a dropdown is better UX
// than a freeform string.

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { api, PlaychartApiError, type LeaderboardEntry } from '../lib/api.js'
import { log } from '../lib/log.js'

const ACCENT = 0xe8a838

// Genre values that map to BP's Genre.name. Update if BP renames
// genres or adds more. Order is by likely popularity in the server.
const GENRE_CHOICES = [
  'Action',
  'RPG',
  'Adventure',
  'Strategy',
  'Indie',
  'Shooter',
  'Platformer',
  'Puzzle',
  'Simulation',
  'Sports',
  'Racing',
  'Fighting',
] as const

export const leaderboard = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top-rated games on Playchart.')
    .addStringOption((opt) =>
      opt
        .setName('genre')
        .setDescription('Filter by genre (defaults to all)')
        .setRequired(false)
        .addChoices(
          ...GENRE_CHOICES.map((g) => ({ name: g, value: g.toLowerCase() })),
        ),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('top')
        .setDescription('How many to show (default 10, max 25).')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const genre = interaction.options.getString('genre') ?? undefined
    const limit = interaction.options.getInteger('top') ?? 10

    await interaction.deferReply()

    try {
      const result = await api.leaderboard({ genre, limit })

      if (result.leaderboard.length === 0) {
        await interaction.editReply({
          content: genre
            ? `// EMPTY // no games rated yet in **${genre}**.`
            : `// EMPTY // no games rated yet. Get voting at [playchart.gg](https://www.playchart.gg).`,
        })
        return
      }

      const embed = renderLeaderboardEmbed(result.leaderboard, genre)
      await interaction.editReply({ embeds: [embed] })
    } catch (err) {
      if (err instanceof PlaychartApiError) {
        await interaction.editReply({
          content: messageForError(err.code),
        })
        return
      }
      log.error('leaderboard command — unexpected error', err)
      await interaction.editReply({
        content: '// ERROR // something broke. Try again in a minute.',
      })
    }
  },
}

// ────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────

function renderLeaderboardEmbed(
  entries: LeaderboardEntry[],
  genre: string | undefined,
): EmbedBuilder {
  // Format each line: " 1. Hollow Knight · 1923 (12,847 votes)"
  const lines = entries.map((e) => {
    const rank = String(e.rank).padStart(2, ' ')
    const rating = Math.round(e.globalRating)
    const votes = e.totalVotes.toLocaleString()
    return `\`${rank}.\` **${escapeMd(e.name)}** · ${rating} (${votes})`
  })

  const title = genre
    ? `// CHART // ${genre.toUpperCase()}`
    : `// CHART // GLOBAL`

  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(title)
    .setURL('https://www.playchart.gg/leaderboard')
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `rating · (votes)`,
    })
}

function escapeMd(s: string): string {
  return s.replace(/([\\*_`~\[\]()<>|])/g, '\\$1')
}

function messageForError(code: string): string {
  switch (code) {
    case 'unauthorized':
    case 'invalid_input':
      return `// ERROR // the bot can't reach Playchart right now. Ping a mod.`
    default:
      return `// ERROR // unexpected response (${code}). Ping a mod.`
  }
}
