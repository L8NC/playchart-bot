// Fires when someone joins a guild. If their Discord is linked to a
// PlayChart account, give them the linked role — covers people who
// rejoin, and people who linked before ever joining the server.
// Never throws: a failed lookup or role add is logged and skipped.

import type { GuildMember } from 'discord.js'
import { env } from '../env.js'
import { api } from '../lib/api.js'
import { log } from '../lib/log.js'

export async function onGuildMemberAdd(member: GuildMember): Promise<void> {
  if (member.user.bot) return
  if (!env.linkedRoleId) return
  // Private bot, but only ever act in the PlayChart guild.
  if (!env.discordGuildId || member.guild.id !== env.discordGuildId) return

  let linked: boolean
  try {
    ;({ linked } = await api.isLinked(member.id))
  } catch (err) {
    log.error(`linked lookup failed // ${member.id}`, err)
    return
  }
  if (!linked) return

  try {
    await member.roles.add(env.linkedRoleId, 'PlayChart account linked')
    log.info(`linked role added // ${member.user.tag} (${member.id})`)
  } catch (err) {
    log.error(`linked role add failed // ${member.id}`, err)
  }
}
