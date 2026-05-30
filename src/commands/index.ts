// Registry of every slash command the bot knows about.
// To add a new command:
//   1. Create src/commands/<name>.ts exporting a Command object
//   2. Import it here and add to the `commands` array
//   3. Run `npm run register` to push the new command def to Discord
// Explicit list, no autoloading magic. Easy to reason about.

import type {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'

import { ping } from './ping.js'
import { link } from './link.js'
import { chart } from './chart.js'
import { pollNow } from './poll-now.js'
import { versus } from './versus.js'
import { leaderboard } from './leaderboard.js'
import { announce } from './announce.js'

export type Command = {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
  // Optional — only present on commands with autocomplete options.
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>
}

export const commands: Command[] = [
  ping,
  link,
  chart,
  pollNow,
  versus,
  leaderboard,
  announce,
]

export const commandByName = new Map<string, Command>(
  commands.map((c) => [c.data.name, c]),
)
