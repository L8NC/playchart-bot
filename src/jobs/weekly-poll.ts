// The weekly matchup poll. Cron-scheduled by default, can also
// be fired on demand by an admin via /poll-now.
//
// Lifecycle:
//   1. Fetch two games from /api/bot/matchup/random
//   2. Compose a branded matchup card image (covers on background)
//   3. Post the image as message #1 in #versus
//   4. Post a Discord native poll as message #2, same channel
//   5. When the poll ends, post a follow-up message with the result
//      (the third half is wired in events/messagePollVoteAdd.ts —
//      Discord doesn't emit a clean "ended" event, so we watch
//      vote events and check `poll.resultsFinalized`).
//
// Why two messages: Discord's poll API does not allow attaching
// images to a message that also contains a poll. The image and the
// poll have to be separate posts. They stack in chat and read as
// one block visually.

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
import { log } from '../lib/log.js'

let lastPostedAt: number | null = null
const MIN_GAP_MS = 12 * 60 * 60 * 1000 // 12 hours

const POLL_DURATION_HOURS = 96 // 4 days

/**
 * Run the weekly poll. Called by node-cron on schedule, or by
 * /poll-now on demand. Returns the poll message on success,
 * null if skipped.
 */
export async function runWeeklyPoll(
  client: Client,
  opts: { force?: boolean } = {},
): Promise<Message | null> {
  if (!opts.force && lastPostedAt && Date.now() - lastPostedAt < MIN_GAP_MS) {
    log.warn('weekly poll skipped — last post was less than 12h ago')
    return null
  }

  const channel = await client.channels.fetch(env.discordVersusChannelId)
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.error(
      `weekly poll — channel ${env.discordVersusChannelId} is not a text channel`,
    )
    return null
  }
  const textChannel = channel as TextChannel

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

  // ─── Step 1: compose and post the image ───
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

  if (imageBuffer.length > 0) {
    try {
      const attachment = new AttachmentBuilder(imageBuffer, {
        name: 'matchup.png',
      })
      await textChannel.send({ files: [attachment] })
    } catch (err) {
      log.error('weekly poll — image post failed', err)
      // Continue to the poll regardless.
    }
  }

  // ─── Step 2: post the poll ───
  const posted = await textChannel.send({
    content: composeIntro(matchup.gameA, matchup.gameB),
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
    `**${a.name}** vs **${b.name}**`,
    ``,
    `Four days. One vote each. Defend in the replies.`,
  ].join('\n')
}

function pollQuestion(a: GameRef, b: GameRef): string {
  return `${a.name} or ${b.name}?`
}

// ────────────────────────────────────────────────────────────
// Result follow-up
// ────────────────────────────────────────────────────────────

export async function postPollResult(message: Message): Promise<void> {
  if (!message.poll) return

  const channel = message.channel
  if (!channel.isSendable()) {
    log.warn(`poll result — channel ${channel.id} is not sendable`)
    return
  }

  const answers = [...message.poll.answers.values()]
  if (answers.length !== 2) return

  const totalVotes = answers.reduce((s, a) => s + a.voteCount, 0)
  if (totalVotes === 0) {
    await channel.send({
      content: [
        `// MATCHUP CLOSED // no votes cast.`,
        `Both sides take the L.`,
      ].join('\n'),
    })
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

  await channel.send({ content: body })
  log.info(
    `poll result posted // ${winner.text} ${winPct}% vs ${loser.text} ${losePct}% // ${totalVotes} votes`,
  )
}
