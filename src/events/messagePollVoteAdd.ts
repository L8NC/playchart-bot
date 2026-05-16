// Discord doesn't have a clean "poll ended" event. The closest we
// get: every time someone votes (or the poll auto-finalizes when
// time runs out), we get a MessagePollVoteAdd / MessagePollVoteRemove
// event. On each, we check the poll's resultsFinalized state.
//
// We track which polls we've already posted results for so we don't
// announce twice.

import type { Client, Poll, PartialPoll } from 'discord.js'
import { Events } from 'discord.js'
import { postPollResult } from '../jobs/weekly-poll.js'
import { log } from '../lib/log.js'

// IDs of poll messages we've already posted results for.
// In-memory — loses state on restart, which is fine. Worst case
// after a restart: if a poll finalizes immediately after restart,
// the bot might re-announce it. That's recoverable; we accept it.
const announcedPolls = new Set<string>()

export function registerPollEndedListener(client: Client): void {
  // We listen to both add and remove. The "ended" signal can fire
  // on either depending on timing.
  client.on(Events.MessagePollVoteAdd, async (answer) => {
    await maybePostResult(answer.poll)
  })
  client.on(Events.MessagePollVoteRemove, async (answer) => {
    await maybePostResult(answer.poll)
  })
}

async function maybePostResult(poll: Poll | PartialPoll): Promise<void> {
  // PartialPoll can happen if the message wasn't cached. Re-fetch.
  if (poll.partial) {
    try {
      poll = await poll.fetch()
    } catch (err) {
      log.warn('failed to fetch partial poll')
      return
    }
  }

  if (!poll.resultsFinalized) return

  const messageId = poll.message.id
  if (announcedPolls.has(messageId)) return

  announcedPolls.add(messageId)
  try {
    await postPollResult(poll.message)
  } catch (err) {
    log.error('failed to post poll result', err)
    // Remove from set so a manual retry / next event can re-attempt.
    announcedPolls.delete(messageId)
  }
}
