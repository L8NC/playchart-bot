// The weekly matchup poll. Cron-scheduled by default, can also
// be fired on demand by an admin via /poll-now.
//
// Lifecycle:
//   1. Fetch two games from /api/bot/matchup/random
//   2. Compose a branded matchup card image (covers on background)
//   3. Post the image + intro copy as message #1 in #versus
//   4. Post a Discord native poll as message #2, same channel
//   5. When the poll ends, reply to it with the result. Discord sends
//      no event when a poll expires, so jobs/poll-close.ts sets a timer
//      for the expiry and re-arms open polls on boot.
//
// Why two messages: Discord's poll API does not allow attaching
// images to a message that also contains a poll. The image and the
// poll have to be separate posts. They stack in chat and read as
// one block visually.
//
// Duplicate protection:
//   - In-flight lock, so a cron tick and /poll-now can't overlap.
//   - Unless forced, skip if the bot posted a poll in the channel in
//     the last 12h. Read from Discord, so it survives restarts and
//     covers a second instance.
//   - Every send carries a nonce with enforceNonce, so Discord dedupes
//     REST retries instead of creating a second message.

import {
  Client,
  PollLayoutType,
  ChannelType,
  AttachmentBuilder,
  type Message,
  type TextChannel,
} from 'discord.js'
import { env } from '../env.js'
import { api, PlaychartApiError, type GameRef } from '../lib/api.js'
import { composeVersusImage } from '../lib/compose-versus-image.js'
import { duelAlertMentions, withDuelAlert } from '../lib/duel-alert.js'
import { log } from '../lib/log.js'
import { schedulePollClose } from './poll-close.js'

const MIN_GAP_MS = 12 * 60 * 60 * 1000 // 12 hours
const RECENT_MESSAGE_SCAN = 20

let inFlight = false

export type WeeklyPollResult =
  | { status: 'posted'; message: Message }
  | { status: 'busy' }
  | { status: 'skipped' }

/**
 * Run the weekly poll. Called by node-cron on schedule, or by
 * /poll-now on demand. `busy` means another run holds the lock;
 * `skipped` covers the 12h check and any failure (see logs).
 *
 * `force` skips the 12h recent-poll check. It never bypasses the
 * in-flight lock.
 */
export async function runWeeklyPoll(
  client: Client,
  opts: { force?: boolean } = {},
): Promise<WeeklyPollResult> {
  if (inFlight) {
    log.warn('weekly poll skipped — another run is in flight')
    return { status: 'busy' }
  }
  inFlight = true
  try {
    const message = await postWeeklyPoll(client, opts.force ?? false)
    return message ? { status: 'posted', message } : { status: 'skipped' }
  } finally {
    inFlight = false
  }
}

async function postWeeklyPoll(
  client: Client,
  force: boolean,
): Promise<Message | null> {
  const runId = makeRunId()

  const channel = await client.channels.fetch(env.discordVersusChannelId)
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.error(
      `weekly poll — channel ${env.discordVersusChannelId} is not a text channel`,
    )
    return null
  }
  const textChannel = channel as TextChannel

  if (!force) {
    try {
      if (await hasRecentBotPoll(textChannel, client.user!.id)) {
        log.warn('weekly poll skipped — bot posted a poll less than 12h ago')
        return null
      }
    } catch (err) {
      log.error('weekly poll SKIPPED — recent message check failed', err)
      return null
    }
  }

  let matchup
  try {
    matchup = await api.randomMatchup()
  } catch (err) {
    if (err instanceof PlaychartApiError) {
      log.error(`weekly poll — matchup api failed (${err.code})`)
    } else {
      log.error('weekly poll — matchup api failed', err)
    }
    return null
  }

  const intro = withDuelAlert(composeIntro(matchup.gameA, matchup.gameB))

  // ─── Step 1: compose and post the image + intro ───
  let imageBuffer: Buffer
  try {
    imageBuffer = await composeVersusImage({
      coverAUrl: matchup.gameA.coverUrl ?? null,
      coverBUrl: matchup.gameB.coverUrl ?? null,
    })
  } catch (err) {
    log.error('weekly poll — image composition failed', err)
    // Continue without the image rather than abort — better to post
    // a plain poll than nothing.
    imageBuffer = Buffer.alloc(0)
  }

  let introPosted = false
  if (imageBuffer.length > 0) {
    try {
      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'matchup.png',
      })
      await textChannel.send({
        content: intro,
        files: [attachment],
        allowedMentions: duelAlertMentions(),
        nonce: `wp${runId}i`,
        enforceNonce: true,
      })
      introPosted = true
    } catch (err) {
      log.error('weekly poll — image post failed', err)
      // Continue to the poll regardless; the intro moves onto it.
    }
  }

  // ─── Step 2: post the poll ───
  const posted = await textChannel.send({
    ...(introPosted
      ? {}
      : { content: intro, allowedMentions: duelAlertMentions() }),
    poll: {
      question: { text: pollQuestion(matchup.gameA, matchup.gameB) },
      answers: [
        { text: matchup.gameA.name },
        { text: matchup.gameB.name },
      ],
      allowMultiselect: false,
      duration: env.weeklyPollDurationHours,
      layoutType: PollLayoutType.Default,
    },
    nonce: `wp${runId}p`,
    enforceNonce: true,
  })

  log.info(
    `weekly poll posted // ${matchup.gameA.name} vs ${matchup.gameB.name} // msg ${posted.id}`,
  )
  schedulePollClose(posted)
  return posted
}

async function hasRecentBotPoll(
  channel: TextChannel,
  botId: string,
): Promise<boolean> {
  const recent = await channel.messages.fetch({ limit: RECENT_MESSAGE_SCAN })
  const cutoff = Date.now() - MIN_GAP_MS
  return recent.some(
    (m) => m.author.id === botId && m.poll && m.createdTimestamp > cutoff,
  )
}

// Short id so the nonces fit Discord's 25 char limit.
function makeRunId(): string {
  return (
    Date.now().toString(36).slice(-6) + Math.random().toString(36).slice(2, 6)
  )
}

// ────────────────────────────────────────────────────────────
// Copy. All in voice.
// ────────────────────────────────────────────────────────────

function composeIntro(a: GameRef, b: GameRef): string {
  return [
    `**${a.name}** vs **${b.name}**`,
    ``,
    `Four days. One vote each. Defend in the replies.`,
  ].join('\n')
}

function pollQuestion(a: GameRef, b: GameRef): string {
  return `${a.name} or ${b.name}?`
}
