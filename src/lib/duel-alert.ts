// Duel alert role: the ping, and the self-assign toggle button.
//
// The ping is used on the voting-open message and the result message
// only. The client default is allowedMentions { parse: [] }, so every
// other send stays silent.
//
// The "Duel alerts" button sits on the voting-open message. It's
// stateless (reads the member's current roles on each click), so it
// keeps working on old posts and across restarts.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  MessageFlags,
  RESTJSONErrorCodes,
  type ButtonInteraction,
  type MessageMentionOptions,
} from 'discord.js'
import { env } from '../env.js'
import { log } from './log.js'

export const DUEL_ALERTS_TOGGLE_ID = 'duel_alerts_toggle'

/** Prepends the role mention on its own line. No-op when unset. */
export function withDuelAlert(content: string): string {
  const roleId = env.discordDuelAlertRoleId
  return roleId ? `<@&${roleId}>\n${content}` : content
}

/** allowedMentions for a send that carries the duel alert ping. */
export function duelAlertMentions(): MessageMentionOptions {
  const roleId = env.discordDuelAlertRoleId
  return roleId ? { roles: [roleId] } : { parse: [] }
}

/** Button row for the voting-open message. Empty when the role is unset. */
export function duelAlertComponents(): ActionRowBuilder<ButtonBuilder>[] {
  if (!env.discordDuelAlertRoleId) return []
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(DUEL_ALERTS_TOGGLE_ID)
        .setLabel('Duel alerts')
        .setStyle(ButtonStyle.Secondary),
    ),
  ]
}

/** Adds the duel alert role if the member lacks it, removes it if not. */
export async function handleDuelAlertsToggle(
  interaction: ButtonInteraction,
): Promise<void> {
  const roleId = env.discordDuelAlertRoleId
  if (!roleId || !interaction.guild) {
    await interaction.reply({
      content: '// OFFLINE // duel alerts aren\'t set up right now.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  const member = await interaction.guild.members.fetch(interaction.user.id)
  const hadRole = member.roles.cache.has(roleId)
  try {
    if (hadRole) {
      await member.roles.remove(roleId, 'Duel alerts toggle')
    } else {
      await member.roles.add(roleId, 'Duel alerts toggle')
    }
  } catch (err) {
    if (
      err instanceof DiscordAPIError &&
      err.code === RESTJSONErrorCodes.MissingPermissions
    ) {
      log.error(
        `duel alerts — can't manage role ${roleId}. Needs Manage Roles and a bot role above it.`,
        err,
      )
      await interaction.reply({
        content: '// ERROR // can\'t manage that role. Ping a mod.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    throw err
  }

  await interaction.reply({
    content: hadRole
      ? '// ALERTS OFF //'
      : '// ALERTS ON // you\'ll get pinged for weekly duels.',
    flags: MessageFlags.Ephemeral,
  })
}
