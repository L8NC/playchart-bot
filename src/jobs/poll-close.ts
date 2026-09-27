// Poll close detection + result follow-up.
//
// Discord sends no gateway event when a poll expires, so we can't
// wait for one. Instead:
//   - After posting a poll, set a timer for expiresAt + 60s, fetch the
//     message and post the result if Discord has finalized it. If not
//     finalized yet, retry once 5 minutes later.
//   - On boot, scan recent messages in #versus. Polls that ended in
//     the last 7 days with no result get one now (catch-up, no role
//     ping); open polls get their timer re-armed.
//
// The result is posted as a reply to the poll. "Already announced"
// means a bot message in the channel references that poll, so the
// check reads from Discord and survives restarts.

import type {
  Client,
  Collection,
  Message,
  Snowflake,
  TextBasedChannel,
} from 'discord.js'
import { ChannelType } from 'discord.js'
import { env } from '../env.js'
import { duelAlertMentions, withDuelAlert } from '../lib/duel-alert.js'
import { log } from '../lib/log.js'

const CLOSE_GRACE_MS = 60 * 1000
const FINALIZE_RETRY_MS = 5 * 60 * 1000
const MESSAGE_SCAN = 50
const CATCH_UP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// setTimeout overflows past 2^31-1 ms (~24.8 days). Longer waits go
// in 24 day hops, recomputing the remaining delay each time.
const TIMER_HOP_MS = 24 * 24 * 60 * 60 * 1000

// Polls with a pending close timer, so boot + post can't double-arm.
const scheduled = new Set<Snowflake>()
// Polls whose result is being posted right now.
const posting = new Set<Snowflake>()

/**
 * Arm the close timer for a poll message this bot posted. `ping`
 * controls the duel alert on the result; resumePolls turns it off
 * for polls that ended before boot.
 */
export function schedulePollClose(
  message: Message,
  opts: { ping?: boolean } = {},
): void {
  const ping = opts.ping ?? true
  const expiresAt = message.poll?.expiresAt
  if (!expiresAt) {
    log.warn(`poll close — msg ${message.id} has no expiry, not scheduling`)
    return
  }
  if (scheduled.has(message.id)) return
  scheduled.add(message.id)

  const { channel, id } = message
  setTimerAt(expiresAt.getTime() + CLOSE_GRACE_MS, () => {
    checkPoll(channel, id, true, ping).catch((err) =>
      log.error(`poll close — check for msg ${id} threw`, err),
    )
  })
  log.info(`poll close scheduled // msg ${id} // ${expiresAt.toISOString()}`)
}

async function checkPoll(
  channel: TextBasedChannel,
  pollId: Snowflake,
  retry: boolean,
  ping: boolean,
): Promise<void> {
  const message = await channel.messages.fetch({ message: pollId, force: true })
  if (!message.poll) {
    scheduled.delete(pollId)
    return
  }

  if (message.poll.resultsFinalized) {
    scheduled.delete(pollId)
    await postPollResult(message, { ping })
    return
  }

  if (retry) {
    log.info(`poll close — msg ${pollId} not finalized yet, retrying in 5m`)
    setTimeout(() => {
      checkPoll(channel, pollId, false, ping).catch((err) =>
        log.error(`poll close — retry for msg ${pollId} threw`, err),
      )
    }, FINALIZE_RETRY_MS)
    return
  }

  scheduled.delete(pollId)
  log.warn(`poll close — msg ${pollId} still not finalized, giving up`)
}

/**
 * On boot: post catch-up results (no ping) for polls that ended in
 * the last 7 days and never got one, and re-arm timers for polls
 * still open. Older ended polls are ignored.
 */
export async function resumePolls(client: Client<true>): Promise<void> {
  const channel = await client.channels.fetch(env.discordVersusChannelId)
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.error(
      `poll resume — channel ${env.discordVersusChannelId} is not a text channel`,
    )
    return
  }

  const recent = await channel.messages.fetch({ limit: MESSAGE_SCAN })
  const botId = client.user.id
  const polls = recent.filter((m) => m.author.id === botId && m.poll)

  const now = Date.now()

  for (const message of polls.values()) {
    const poll = message.poll!
    const expiresAt = poll.expiresAt?.getTime()
    if (expiresAt === undefined) continue

    const ended = poll.resultsFinalized || expiresAt <= now
    if (!ended) {
      schedulePollClose(message)
      continue
    }

    if (now - expiresAt > CATCH_UP_MAX_AGE_MS) continue
    if (isAnnounced(recent, message.id, botId)) continue

    if (!poll.resultsFinalized) {
      // Expired but Discord hasn't tallied yet. Timer fires right away
      // and retries once.
      schedulePollClose(message, { ping: false })
      continue
    }

    log.info(`poll resume — msg ${message.id} ended with no result, posting`)
    try {
      await postPollResult(message, { ping: false })
    } catch (err) {
      log.error(`poll resume — result for msg ${message.id} failed`, err)
    }
  }
}

function isAnnounced(
  messages: Collection<Snowflake, Message>,
  pollId: Snowflake,
  botId: Snowflake,
): boolean {
  return messages.some(
    (m) => m.author.id === botId && m.reference?.messageId === pollId,
  )
}

// Run fn at an absolute time. Delays over 24 days wait one hop, then
// recompute from the target and re-arm.
function setTimerAt(targetMs: number, fn: () => void): void {
  const delay = targetMs - Date.now()
  if (delay > TIMER_HOP_MS) {
    setTimeout(() => setTimerAt(targetMs, fn), TIMER_HOP_MS)
    return
  }
  setTimeout(fn, Math.max(0, delay))
}

// ────────────────────────────────────────────────────────────
// Result follow-up
// ────────────────────────────────────────────────────────────

export async function postPollResult(
  message: Message,
  opts: { ping: boolean },
): Promise<void> {
  if (!message.poll) return
  if (posting.has(message.id)) return
  posting.add(message.id)
  try {
    await sendPollResult(message, opts.ping)
  } finally {
    posting.delete(message.id)
  }
}

async function sendPollResult(message: Message, ping: boolean): Promise<void> {
  const poll = message.poll!

  const channel = message.channel
  if (!channel.isSendable()) {
    log.warn(`poll result — channel ${channel.id} is not sendable`)
    return
  }

  const recent = await channel.messages.fetch({ limit: MESSAGE_SCAN })
  if (isAnnounced(recent, message.id, message.client.user.id)) {
    log.info(`poll result — msg ${message.id} already announced, skipping`)
    return
  }

  const answers = [...poll.answers.values()]
  if (answers.length !== 2) return

  const send = (content: string) =>
    channel.send({
      content: ping ? withDuelAlert(content) : content,
      reply: { messageReference: message.id, failIfNotExists: false },
      ...(ping ? { allowedMentions: duelAlertMentions() } : {}),
      nonce: `wp${message.id}r`,
      enforceNonce: true,
    })

  const totalVotes = answers.reduce((s, a) => s + a.voteCount, 0)
  if (totalVotes === 0) {
    await send(
      [
        `// MATCHUP CLOSED // no votes cast.`,
        `Both sides take the L.`,
      ].join('\n'),
    )
    return
  }

  const sorted = [...answers].sort((a, b) => b.voteCount - a.voteCount)
  const winner = sorted[0]
  const loser = sorted[1]
  const winPct = Math.round((winner.voteCount / totalVotes) * 100)
  const losePct = Math.round((loser.voteCount / totalVotes) * 100)

  let body: string
  if (winner.voteCount === loser.voteCount) {
    body = [
      `// MATCHUP CLOSED // dead heat.`,
      ``,
      `**${winner.text}** ${winPct}% — **${loser.text}** ${losePct}%`,
      `${totalVotes} votes. Argue it out below.`,
    ].join('\n')
  } else if (winPct >= 75) {
    body = [
      `// MATCHUP CLOSED // landslide.`,
      ``,
      `**${winner.text}** ${winPct}% — **${loser.text}** ${losePct}%`,
      `${totalVotes} votes. Not even close.`,
    ].join('\n')
  } else {
    body = [
      `// MATCHUP CLOSED //`,
      ``,
      `**${winner.text}** ${winPct}% — **${loser.text}** ${losePct}%`,
      `${totalVotes} votes. See you next Sunday.`,
    ].join('\n')
  }

  await send(body)
  log.info(
    `poll result posted // ${winner.text} ${winPct}% vs ${loser.text} ${losePct}% // ${totalVotes} votes`,
  )
}
