// Buffer GraphQL API client. Schedules a post with an image URL
// and tweet text to a specified Buffer channel at a specified time.
//
// Docs:  https://developers.buffer.com/
// Auth:  Bearer token (personal API token from Buffer dashboard).
// URL:   https://api.buffer.com  (NOT graphql.buffer.com)
//
// Note: Buffer's GraphQL API is in public beta as of 2026.
// If mutation fields or response shapes change, this is the file
// to update.

import { env } from '../env.js'
import { log } from './log.js'

export class BufferError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BufferError'
  }
}

const BUFFER_API_URL = 'https://api.buffer.com'

/**
 * Schedule a tweet (with an image) to be posted at a given time.
 * Returns the Buffer post ID.
 *
 * `scheduledAt` is a UNIX timestamp in seconds, UTC. Buffer expects
 * an ISO datetime string, which we derive from this.
 *
 * Uses `customScheduled` mode + `dueAt` for precise time control.
 * The alternative `addToQueue` mode would put it in your Buffer
 * posting-queue schedule, which has its own concept of slots —
 * we'd lose explicit time control.
 */
export async function scheduleBufferPost(opts: {
  channelId: string
  text: string
  imageUrl: string
  scheduledAt: number
}): Promise<string> {
  const dueAt = new Date(opts.scheduledAt * 1000).toISOString()

  // Per Buffer's "Create Image Post" example, imageUrl is its own
  // argument on the createPost input. Response is a union of
  // PostActionSuccess | MutationError — we match on both via
  // GraphQL `... on` fragments.
  const mutation = `
    mutation ScheduleMatchupPost(
      $text: String!
      $channelId: String!
      $imageUrl: String!
      $dueAt: DateTime!
    ) {
      createPost(input: {
        text: $text
        channelId: $channelId
        imageUrl: $imageUrl
        schedulingType: automatic
        mode: customScheduled
        dueAt: $dueAt
      }) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `

  const variables = {
    text: opts.text,
    channelId: opts.channelId,
    imageUrl: opts.imageUrl,
    dueAt,
  }

  const res = await fetch(BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.bufferApiToken}`,
    },
    body: JSON.stringify({ query: mutation, variables }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    log.error(`buffer http error: ${res.status} ${text.slice(0, 300)}`)
    throw new BufferError('http_error', `${res.status}`)
  }

  // Buffer returns HTTP 200 even on logical errors — they're in the body.
  type CreatePostPayload =
    | { post: { id: string; text: string; dueAt: string } }  // PostActionSuccess
    | { message: string }                                     // MutationError

  type GqlResponse = {
    data?: { createPost?: CreatePostPayload }
    errors?: { message: string; extensions?: { code?: string } }[]
  }
  const body = (await res.json()) as GqlResponse

  // System-level errors (auth, malformed query) live in `errors`.
  if (body.errors && body.errors.length > 0) {
    const first = body.errors[0]
    const code = first.extensions?.code ?? 'graphql_error'
    log.error(`buffer system error (${code}): ${first.message}`)
    throw new BufferError(code, first.message)
  }

  const payload = body.data?.createPost
  if (!payload) {
    throw new BufferError('empty_response', 'Buffer returned no createPost payload')
  }

  // Mutation-level errors come back as { message }.
  if ('message' in payload) {
    log.error(`buffer mutation error: ${payload.message}`)
    throw new BufferError('mutation_error', payload.message)
  }

  log.info(`buffer scheduled // post ${payload.post.id} dueAt ${payload.post.dueAt}`)
  return payload.post.id
}
