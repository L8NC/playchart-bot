// Registry of every slash command the bot knows about.
// To add a new command:
//   1. Create src/commands/<name>.ts exporting a Command object
//   2. Import it here and add to the `commands` array
// Explicit list, no autoloading magic. Easy to reason about.

import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js'

import { ping } from './ping.js'

export type Command = {
  data:
    | SlashCommandBuilder
    | SlashCommandOptionsOnlyBuilder
    | SlashCommandSubcommandsOnlyBuilder
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

export const commands: Command[] = [ping]

export const commandByName = new Map<string, Command>(
  commands.map((c) => [c.data.name, c]),
)
