// HTTP client for the Playchart bot API.
// Endpoints documented in playchart-bot-api-spec-v1.md.
// This is the single source of truth for how the bot talks to the app.

import { env } from '../env.js'
import { log } from './log.js'

type ApiError = { error: string; message?: string }

export class PlaychartApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'PlaychartApiError'
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${env.playchartApiBase}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.playchartApiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    let parsed: ApiError = { error: 'unknown_error' }
    try {
      parsed = (await res.json()) as ApiError
    } catch {
      // Body wasn't JSON. Use status text fallback.
    }
    log.warn(`api ${method} ${path} -> ${res.status} ${parsed.error}`)
    throw new PlaychartApiError(res.status, parsed.error, parsed.message)
  }

  return (await res.json()) as T
}

// ────────────────────────────────────────────────────────────
// Response types. Mirror the shapes in the API spec doc.
// Keep these tight — if BP changes the shape, change it here too.
// ────────────────────────────────────────────────────────────

export type ChartGame = {
  rank: number
  gameId: number
  name: string
  slug: string
  coverUrl: string | null
  rating: number
  releaseYear?: number
}

export type ChartResponse = {
  user: {
    username: string
    displayName: string | null
    avatarUrl: string | null
    totalVotes: number
  }
  chart: ChartGame[]
}

export type GameRef = {
  gameId: number
  name: string
  slug: string
  releaseYear?: number
  coverUrl?: string | null
}

export type VersusResponse = {
  gameA: GameRef
  gameB: GameRef
  totalMatchups: number
  gameAWins: number
  gameBWins: number
  gameAWinRate: number
}

export type LeaderboardEntry = {
  rank: number
  gameId: number
  name: string
  slug: string
  coverUrl: string | null
  globalRating: number
  totalVotes: number
}

export type LeaderboardResponse = {
  scope: { genre?: string }
  leaderboard: LeaderboardEntry[]
}

export type MatchupResponse = {
  gameA: GameRef
  gameB: GameRef
}

// ────────────────────────────────────────────────────────────
// Endpoint methods. Order matches the spec.
// ────────────────────────────────────────────────────────────

export const api = {
  consumeLinkCode(body: {
    code: string
    discordId: string
    discordUsername: string
  }) {
    return request<{ userId: string; username: string }>(
      'POST',
      '/link/consume',
      body,
    )
  },

  chartByDiscordId(discordId: string, limit = 5) {
    return request<ChartResponse>(
      'GET',
      `/users/by-discord/${discordId}/chart?limit=${limit}`,
    )
  },

  chartByUsername(username: string, limit = 5) {
    return request<ChartResponse>(
      'GET',
      `/users/by-username/${encodeURIComponent(username)}/chart?limit=${limit}`,
    )
  },

  searchGames(query: string, limit = 10) {
    return request<{ results: GameRef[] }>(
      'GET',
      `/games/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    )
  },

  versus(gameAId: number, gameBId: number) {
    return request<VersusResponse>(
      'GET',
      `/games/versus?a=${gameAId}&b=${gameBId}`,
    )
  },

  leaderboard(opts: { limit?: number; genre?: string } = {}) {
    const params = new URLSearchParams()
    if (opts.limit) params.set('limit', String(opts.limit))
    if (opts.genre) params.set('genre', opts.genre)
    return request<LeaderboardResponse>(
      'GET',
      `/leaderboard?${params.toString()}`,
    )
  },

  randomMatchup() {
    return request<MatchupResponse>('GET', '/matchup/random')
  },
}
