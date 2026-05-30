// /announce target:#channel image:[optional]
//
// Founder-role-only. Composes a polished embed in a private flow
// and posts it to a chosen target channel after preview.
//
// Flow:
//   1. /announce with target + optional image attachment
//   2. Modal opens for title + body
//   3. Ephemeral preview with [Post it] [Discard] buttons
//   4. Post it → embed lands in target channel
//      Discard → preview marked discarded
//
// State note: between modal submit and button click, we encode the
// announcement payload into the button's custom_id so we don't need
// server-side session state. Discord caps custom_id at 100 chars,
// so we use a short in-memory map keyed by a random nonce instead.

import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  ChannelType,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type TextChannel,
  type NewsChannel,
} from 'discord.js'
import { log } from '../lib/log.js'

// ACID accent. Distinct from the amber used elsewhere so announcements
// look visually different from data commands like /chart.
const ACCENT_ACID = 0xd4ff3a

// Founder role name. If you rename the role in Discord, update this string.
// Could be made into an env var later; for now hardcoded since this command
// won't ever be used in another server.
const FOUNDER_ROLE_NAME = 'Founder'

// Maximum lifetime of a pending preview in the in-memory cache. After
// this, the buttons stop working and the user has to re-compose. Long
// enough that a slow editor isn't punished, short enough that we don't
// leak memory forever.
const PREVIEW_TTL_MS = 15 * 60 * 1000 // 15 minutes

// In-memory store of pending previews keyed by a random nonce. The
// nonce is encoded into the button's custom_id. When the user clicks,
// we look up the full payload here.
//
// Lives only in this process. Restarts = pending previews lost.
// Acceptable: worst case, user re-composes. Not data-loss-sensitive.
type PendingPreview = {
  targetChannelId: string
  title: string | null
  body: string
  imageUrl: string | null
  createdAt: number
}
const pendingPreviews = new Map<string, PendingPreview>()

// Periodic cleanup of expired entries. Runs every 5 minutes.
// Started lazily on first use so we don't add a background task at boot
// just because the file got imported.
let cleanupStarted = false
function ensureCleanup(): void {
  if (cleanupStarted) return
  cleanupStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [nonce, preview] of pendingPreviews) {
      if (now - preview.createdAt > PREVIEW_TTL_MS) {
        pendingPreviews.delete(nonce)
      }
    }
  }, 5 * 60 * 1000)
}

export const announce = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Founder-only. Compose and post an announcement embed.')
    .addChannelOption((opt) =>
      opt
        .setName('target')
        .setDescription('Channel to post the announcement in.')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addAttachmentOption((opt) =>
      opt
        .setName('image')
        .setDescription('Optional image to embed.')
        .setRequired(false),
    )
    // Role-gate the command via Discord's built-in permission system.
    // setDefaultMemberPermissions(0) hides it from everyone by default,
    // then the role gate in execute() does the actual check. This makes
    // it disappear from autocomplete for non-founders, which is nicer
    // than "command shows up, errors when used."
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    ensureCleanup()

    // Role check. setDefaultMemberPermissions handles most of this, but
    // we double-check by name in case the role hierarchy isn't aligned.
    if (!hasFounderRole(interaction)) {
      await interaction.reply({
        content: '// LOCKED // this command is founder-only.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    const target = interaction.options.getChannel('target', true)
    const image = interaction.options.getAttachment('image')

    // Validate the image is actually an image. Discord lets you attach
    // anything; we reject non-images here so the user finds out now
    // instead of after writing the body.
    if (image && !isImageAttachment(image)) {
      await interaction.reply({
        content: '// REJECTED // attachment must be an image (png, jpg, gif, webp).',
        flags: MessageFlags.Ephemeral,
      })
      return
    }

    // Stash the target + image data in a short-lived modal context.
    // Discord modals can't carry arbitrary data — but custom_id can,
    // up to 100 chars. We pack target channel ID and an optional
    // image nonce (so we can retrieve the URL later) into the modal's
    // custom_id, then read them back on submit.
    const stagedNonce = randomNonce()
    if (image) {
      // Store the image URL keyed by nonce. Will be looked up on submit.
      pendingImages.set(stagedNonce, {
        url: image.url,
        createdAt: Date.now(),
      })
    }

    const customId = `announce_modal:${target.id}:${image ? stagedNonce : 'none'}`

    const modal = new ModalBuilder()
      .setCustomId(customId)
      .setTitle('Compose announcement')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('title')
            .setLabel('Title (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(256),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('body')
            .setLabel('Body')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setPlaceholder('Write your announcement. Discord markdown supported.'),
        ),
      )

    await interaction.showModal(modal)
  },
}

// ────────────────────────────────────────────────────────────
// Modal submit handler. Wired up in events/interactionCreate.ts.
// ────────────────────────────────────────────────────────────

export async function handleAnnounceModalSubmit(
  interaction: ModalSubmitInteraction,
): Promise<void> {
  // custom_id format: announce_modal:<targetChannelId>:<imageNonce|none>
  const parts = interaction.customId.split(':')
  if (parts.length !== 3 || parts[0] !== 'announce_modal') return

  const targetChannelId = parts[1]
  const imageNonce = parts[2]

  // Retrieve image URL if we stashed one earlier.
  let imageUrl: string | null = null
  if (imageNonce !== 'none') {
    const staged = pendingImages.get(imageNonce)
    if (staged) {
      imageUrl = staged.url
      pendingImages.delete(imageNonce)
    }
  }

  const title = interaction.fields.getTextInputValue('title').trim() || null
  const body = interaction.fields.getTextInputValue('body').trim()

  if (!body) {
    await interaction.reply({
      content: '// EMPTY // body can\'t be empty.',
      flags: MessageFlags.Ephemeral,
    })
    return
  }

  // Stash full preview under a new nonce. The Post/Discard buttons
  // will reference this nonce in their custom_ids.
  const previewNonce = randomNonce()
  pendingPreviews.set(previewNonce, {
    targetChannelId,
    title,
    body,
    imageUrl,
    createdAt: Date.now(),
  })

  // Build the preview embed.
  const embed = buildAnnouncementEmbed({ title, body, imageUrl })

  // Fetch the target channel name for the preview header.
  let targetLabel = `<#${targetChannelId}>`
  try {
    const ch = await interaction.client.channels.fetch(targetChannelId)
    if (ch && 'name' in ch && ch.name) targetLabel = `#${ch.name}`
  } catch {
    // Fallback to the raw mention if fetch fails.
  }

  const postButton = new ButtonBuilder()
    .setCustomId(`announce_post:${previewNonce}`)
    .setLabel('Post it')
    .setStyle(ButtonStyle.Success)

  const discardButton = new ButtonBuilder()
    .setCustomId(`announce_discard:${previewNonce}`)
    .setLabel('Discard')
    .setStyle(ButtonStyle.Secondary)

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    postButton,
    discardButton,
  )

  await interaction.reply({
    content: `// PREVIEW // will post to ${targetLabel}`,
    embeds: [embed],
    components: [row],
    flags: MessageFlags.Ephemeral,
  })
}

// ────────────────────────────────────────────────────────────
// Button click handlers — Post it / Discard.
// ────────────────────────────────────────────────────────────

export async function handleAnnounceButton(
  interaction: ButtonInteraction,
): Promise<void> {
  // custom_id: announce_post:<nonce> or announce_discard:<nonce>
  const [action, nonce] = interaction.customId.split(':')
  if (!nonce) return

  const preview = pendingPreviews.get(nonce)
  if (!preview) {
    await interaction.update({
      content: '// EXPIRED // this preview is no longer valid. Run `/announce` again.',
      embeds: [],
      components: [],
    })
    return
  }

  if (action === 'announce_discard') {
    pendingPreviews.delete(nonce)
    await interaction.update({
      content: '// DISCARDED //',
      embeds: [],
      components: [],
    })
    return
  }

  if (action === 'announce_post') {
    // Re-check founder role at click time. If they lost the role
    // between compose and post, deny.
    if (!hasFounderRole(interaction)) {
      await interaction.update({
        content: '// LOCKED // founder role required to post.',
        embeds: [],
        components: [],
      })
      return
    }

    // Fetch target channel and post.
    let channel
    try {
      channel = await interaction.client.channels.fetch(preview.targetChannelId)
    } catch (err) {
      log.error('announce — failed to fetch target channel', err)
      await interaction.update({
        content: '// FAILED // could not reach target channel.',
        embeds: [],
        components: [],
      })
      return
    }

    if (
      !channel ||
      !channel.isTextBased() ||
      !('send' in channel)
    ) {
      await interaction.update({
        content: '// FAILED // target is not a sendable text channel.',
        embeds: [],
        components: [],
      })
      return
    }

    const embed = buildAnnouncementEmbed(preview)

    try {
      const posted = await (channel as TextChannel | NewsChannel).send({
        embeds: [embed],
      })
      pendingPreviews.delete(nonce)
      await interaction.update({
        content: `// POSTED // ${posted.url}`,
        embeds: [],
        components: [],
      })
      log.info(
        `announce posted // ${interaction.user.username} -> ${preview.targetChannelId} // msg ${posted.id}`,
      )
    } catch (err) {
      log.error('announce — failed to post', err)
      await interaction.update({
        content: '// FAILED // see logs. The post did not go through.',
        embeds: [],
        components: [],
      })
    }
  }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function buildAnnouncementEmbed(opts: {
  title: string | null
  body: string
  imageUrl: string | null
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ACCENT_ACID)
    .setDescription(opts.body)

  if (opts.title) {
    embed.setTitle(opts.title)
  }
  if (opts.imageUrl) {
    embed.setImage(opts.imageUrl)
  }

  return embed
}

function hasFounderRole(interaction: {
  member: unknown
}): boolean {
  const member = interaction.member as { roles?: { cache?: Map<string, { name: string }> } }
  if (!member?.roles?.cache) return false
  for (const role of member.roles.cache.values()) {
    if (role.name === FOUNDER_ROLE_NAME) return true
  }
  return false
}

function isImageAttachment(att: { contentType?: string | null; name?: string | null }): boolean {
  if (att.contentType?.startsWith('image/')) return true
  // Fallback: extension sniff in case contentType is missing.
  const name = (att.name ?? '').toLowerCase()
  return /\.(png|jpe?g|gif|webp)$/.test(name)
}

function randomNonce(): string {
  // 8 hex chars is enough — collisions are essentially zero across a 15min window.
  return Math.random().toString(16).slice(2, 10).padStart(8, '0')
}

// Separate cache for image URLs staged between slash command and modal submit.
// Same TTL as previews. Cleaned up by the same interval.
type StagedImage = { url: string; createdAt: number }
const pendingImages = new Map<string, StagedImage>()
