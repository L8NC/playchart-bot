// Admin gate for founder-only commands (/poll-now, /announce).
// Checks DISCORD_FOUNDER_ROLE_ID against the invoking member's roles.

import { GuildMemberRoleManager, type Interaction } from 'discord.js'
import { env } from '../env.js'

export const FOUNDER_NOT_CONFIGURED =
  '// LOCKED // founder role not configured.'

/** True when the founder role is set in env. */
export function isFounderConfigured(): boolean {
  return env.discordFounderRoleId !== ''
}

/**
 * True if the member who triggered the interaction has the founder
 * role. The member is a GuildMember (cached guild) or a raw API member
 * whose roles are a string[] of IDs; both are handled. DMs and an
 * unset role return false.
 */
export function isFounder(interaction: Pick<Interaction, 'member'>): boolean {
  const roleId = env.discordFounderRoleId
  if (!roleId) return false
  const roles = interaction.member?.roles
  if (!roles) return false
  if (roles instanceof GuildMemberRoleManager) return roles.cache.has(roleId)
  return roles.includes(roleId)
}
