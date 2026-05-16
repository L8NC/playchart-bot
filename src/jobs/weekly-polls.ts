// The weekly matchup poll. Cron-scheduled by default, can also
// be fired on demand by an admin via /poll-now.
//
// Lifecycle:
//   1. Fetch two games from /api/bot/matchup/random
//   2. Post a 24h Discord poll in #versus with the two games
//   3. When the poll ends (Discord emits MessagePollVoteAdd
//      events, plus a final "ended" state we read on demand),
//      we post a follow-up message announcing the winner.
//
// The second half (result follow-up) lives in events/messagePollVoteRemove.ts
// — Discord doesn't have a clean "poll ended" event; we listen for
// vote events on poll messages and check `poll.resultsFinalized`.

import {
  Client,
  PollLayoutType,
  ChannelType,
  type Message,
  type TextChannel,
} from 'discord.js'
import { env } from '../env.js'
import { api, PlaychartApiError, type GameRef } from '../lib/api.js'
import { log } from '../lib/log.js'

// In-memory guard against double-firing. Stores the timestamp of
// the most recent poll post. Loses state on bot restart — but a
// restart in the cron firing window is unlikely enough that we
// don't need persistent storage for V1.
let lastPostedAt: number | null = null
const MIN_GAP_MS = 12 * 60 * 60 * 1000 // 12 hours

const POLL_DURATION_HOURS = 24

/**
 * Run the weekly poll. Called by node-cron on schedule, or by
 * /poll-now on demand. Returns the posted message on success,
 * null if skipped (e.g. recent post already exists).
 */
export async function runWeeklyPoll(
  client: Client,
  opts: { force?: boolean } = {},
): Promise<Message | null> {
  // Idempotency guard.
  if (!opts.force && lastPostedAt && Date.now() - lastPostedAt < MIN_GAP_MS) {
    log.warn('weekly poll skipped — last post was less than 12h ago')
    return null
  }

  // Get the channel.
  const channel = await client.channels.fetch(env.discordVersusChannelId)
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.error(
      `weekly poll — channel ${env.discordVersusChannelId} is not a text channel`,
    )
    return null
  }
  const textChannel = channel as TextChannel

  // Get the matchup.
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

  // Compose intro message + poll.
  const intro = composeIntro(matchup.gameA, matchup.gameB)
  const posted = await textChannel.send({
    content: intro,
    poll: {
      question: { text: pollQuestion(matchup.gameA, matchup.gameB) },
      answers: [
        { text: matchup.gameA.name },
        { text: matchup.gameB.name },
      ],
      allowMultiselect: false,
      duration: POLL_DURATION_HOURS,
      layoutType: PollLayoutType.Default,
    },
  })

  lastPostedAt = Date.now()
  log.info(
    `weekly poll posted // ${matchup.gameA.name} vs ${matchup.gameB.name} // msg ${posted.id}`,
  )
  return posted
}

// ────────────────────────────────────────────────────────────
// Copy. All in voice.
// ────────────────────────────────────────────────────────────

function composeIntro(a: GameRef, b: GameRef): string {
  return [
    `// MATCHUP //`,
    ``,
    `**${a.name}** vs **${b.name}**`,
    ``,
    `24 hours. One vote each. Defend in the replies.`,
  ].join('\n')
}

function pollQuestion(a: GameRef, b: GameRef): string {
  // Discord pollQuestion max is 300 chars; we'll never exceed.
  return `${a.name} or ${b.name}?`
}

// ────────────────────────────────────────────────────────────
// Result follow-up
// ────────────────────────────────────────────────────────────

/**
 * Called by the poll-event handler when a poll's results are
 * finalized. Posts a follow-up announcing the result.
 */
export async function postPollResult(message: Message): Promise<void> {
  if (!message.poll) return

  const answers = [...message.poll.answers.values()]
  if (answers.length !== 2) {
    // Not one of our matchup polls — skip.
    return
  }

  const totalVotes = answers.reduce((s, a) => s + a.voteCount, 0)
  if (totalVotes === 0) {
    await message.channel.send({
      content: [
        `// MATCHUP CLOSED // no votes cast.`,
        `Both sides take the L.`,
      ].join('\n'),
    })
    return
  }

  // Sort by vote count desc.
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

  await message.channel.send({ content: body })
  log.info(
    `poll result posted // ${winner.text} ${winPct}% vs ${loser.text} ${losePct}% // ${totalVotes} votes`,
  )
}
