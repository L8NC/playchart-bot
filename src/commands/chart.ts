// /chart [user] [username] [top]
//
// Posts a user's top 5 (or top N) games as a public embed.
//
// Lookup priority:
//   1. If `user` (Discord mention) provided → look up that Discord ID
//   2. Else if `username` provided → look up that Playchart username
//   3. Else → look up the caller's Discord ID
//
// Embed layout:
//   ┌─────────────────────────────────────────┐
//   │ 🟡 playchart.gg/username                │
//   │ Display Name                       [▢]  │
//   │                                         │
//   │ 1.  Hollow Knight (2017) · 1834         │
//   │ 2.  Elden Ring (2022) · 1791            │
//   │ 3.  ...                                 │
//   │                                         │
//   │ playchart.gg/username · 1,247 votes     │
//   └─────────────────────────────────────────┘

import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { api, PlaychartApiError, type ChartResponse } from '../lib/api.js'
import { log } from '../lib/log.js'

// Brand-aligned accent color. Deep amber — arcade UI energy.
const ACCENT = 0xe8a838

const PROFILE_URL = (username: string) => `https://playchart.gg/${encodeURIComponent(username)}`

export const chart = {
  data: new SlashCommandBuilder()
    .setName('chart')
    .setDescription("Show someone's Playchart top games. Defaults to you.")
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('A linked Discord user (defaults to you).')
        .setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('username')
        .setDescription("A Playchart username (use this if they're not on Discord).")
        .setRequired(false)
        .setMinLength(1)
        .setMaxLength(40),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('top')
        .setDescription('How many to show (default 5, max 25).')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25),
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const discordUserOpt = interaction.options.getUser('user')
    const usernameOpt = interaction.options.getString('username')
    const limit = interaction.options.getInteger('top') ?? 5

    // Public reply — charts are for sharing.
    await interaction.deferReply()

    try {
      let result: ChartResponse
      let lookupSubject: 'self' | 'other-discord' | 'other-username'

      if (discordUserOpt) {
        result = await api.chartByDiscordId(discordUserOpt.id, limit)
        lookupSubject = 'other-discord'
      } else if (usernameOpt) {
        result = await api.chartByUsername(usernameOpt.trim(), limit)
        lookupSubject = 'other-username'
      } else {
        result = await api.chartByDiscordId(interaction.user.id, limit)
        lookupSubject = 'self'
      }

      const embed = renderChartEmbed(result, limit)
      await interaction.editReply({ embeds: [embed] })
    } catch (err) {
      if (err instanceof PlaychartApiError) {
        await interaction.editReply({
          content: messageForError(err.code, {
            discordUser: discordUserOpt,
            username: usernameOpt,
            isSelfLookup: !discordUserOpt && !usernameOpt,
          }),
        })
        return
      }
      log.error('chart command — unexpected error', err)
      await interaction.editReply({
        content: '// ERROR // something broke. Try again in a minute.',
      })
    }
  },
}

// ────────────────────────────────────────────────────────────
// Rendering
// ────────────────────────────────────────────────────────────

function renderChartEmbed(data: ChartResponse, requested: number): EmbedBuilder {
  const { user, chart: games } = data

  const heading = user.displayName || user.username
  const profileUrl = PROFILE_URL(user.username)

  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setAuthor({ name: `playchart.gg/${user.username}`, url: profileUrl })
    .setTitle(heading)
    .setURL(profileUrl)

  if (user.avatarUrl) {
    embed.setThumbnail(user.avatarUrl)
  }

  if (games.length === 0) {
    // No chart yet — first-time user or someone who just linked.
    embed.setDescription(
      [
        `// NO CHART YET //`,
        ``,
        `Vote on a few matchups at [playchart.gg](${profileUrl})`,
        `and run \`/chart\` again.`,
      ].join('\n'),
    )
    return embed
  }

  // Format each line: "1.  Hollow Knight (2017) · 1834"
  const lines = games.map((g) => {
    const rank = String(g.rank).padStart(2, ' ')
    const year = g.releaseYear ? ` (${g.releaseYear})` : ''
    const rating = Math.round(g.rating)
    return `\`${rank}.\` **${escapeMd(g.name)}**${year} · ${rating}`
  })

  embed.setDescription(lines.join('\n'))

  // Footer notes the total vote count — context for how meaningful the chart is.
  // 12 votes is barely a chart. 1,200 is.
  const votes = user.totalVotes.toLocaleString()
  const showingNote =
    games.length < requested
      ? `${games.length} ranked`
      : `top ${games.length}`
  embed.setFooter({
    text: `${showingNote} · ${votes} matchups voted`,
  })

  return embed
}

// Escape Discord markdown that might appear in game titles
// (asterisks, underscores, brackets, etc).
function escapeMd(s: string): string {
  return s.replace(/([\\*_`~\[\]()<>|])/g, '\\$1')
}

// ────────────────────────────────────────────────────────────
// Error copy
// ────────────────────────────────────────────────────────────

type LookupContext = {
  discordUser: { id: string; username: string } | null
  username: string | null
  isSelfLookup: boolean
}

function messageForError(code: string, ctx: LookupContext): string {
  switch (code) {
    case 'user_not_linked':
      if (ctx.isSelfLookup) {
        return [
          `// NOT LINKED //`,
          ``,
          `Run \`/link\` first to connect your Discord to Playchart.`,
          `Get a code at https://playchart.gg/settings/discord`,
        ].join('\n')
      }
      if (ctx.discordUser) {
        return `// NOT LINKED // <@${ctx.discordUser.id}> hasn't linked Playchart yet.`
      }
      return `// NOT LINKED // that account isn't linked to Discord.`

    case 'user_not_found':
      // Only reachable on username lookups — Discord-ID lookup returns user_not_linked.
      return `// NO SUCH USER // no Playchart account named \`${escapeMd(ctx.username ?? '?')}\`.`

    case 'unauthorized':
    case 'invalid_input':
      return `// ERROR // the bot can't reach Playchart right now. Ping a mod.`

    default:
      return `// ERROR // unexpected response (${code}). Ping a mod.`
  }
}
