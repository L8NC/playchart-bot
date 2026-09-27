// Duel alert role ping. Used on the voting-open message and the
// result message only. The client default is allowedMentions
// { parse: [] }, so every other send stays silent.

import type { MessageMentionOptions } from 'discord.js'
import { env } from '../env.js'

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
