// Helper script. Lists all your Buffer channels so you can copy
// the Twitter channel ID into BUFFER_TWITTER_CHANNEL_ID.
//
// Usage:
//   npm run buffer-channels
//
// Requires BUFFER_API_TOKEN to be set in your local .env.

import { env } from '../src/env.js'

const BUFFER_API_URL = 'https://api.buffer.com'

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(BUFFER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.bufferApiToken}`,
    },
    body: JSON.stringify({ query, variables }),
  })
  const body = (await res.json()) as {
    data?: T
    errors?: { message: string }[]
  }
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '))
  }
  if (!body.data) {
    throw new Error('no data in response')
  }
  return body.data
}

async function main() {
  if (!env.bufferApiToken) {
    console.error('// CONFIG ERROR // set BUFFER_API_TOKEN in .env first')
    process.exit(1)
  }

  // 1. Get organizations. Buffer requires an input arg even if empty —
  //    pass an empty filter.
  type OrgsResp = { organizations: { id: string; name: string }[] }
  const orgsData = await gql<OrgsResp>(
    `query Orgs { organizations(input: {}) { id name } }`,
  )

  const orgs = orgsData.organizations ?? []
  if (orgs.length === 0) {
    console.error('// NONE // no organizations found on this token')
    return
  }

  // 2. For each org, list channels.
  type ChansResp = {
    channels: { id: string; name: string; service: string }[]
  }
  for (const org of orgs) {
    console.log(`\n// ORG // ${org.name} (${org.id})`)
    try {
      const chans = await gql<ChansResp>(
        `query Chans($orgId: String!) {
          channels(input: { organizationId: $orgId }) {
            id name service
          }
        }`,
        { orgId: org.id },
      )
      const list = chans.channels ?? []
      if (list.length === 0) {
        console.log('  (no channels)')
        continue
      }
      for (const ch of list) {
        const marker = ch.service === 'twitter' ? '←' : ' '
        console.log(`  ${marker} ${ch.service.padEnd(12)} ${ch.id}  ${ch.name}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  // ERROR // ${msg}`)
    }
  }

  console.log(
    '\n// COPY THE TWITTER ID // paste into BUFFER_TWITTER_CHANNEL_ID in your .env and Railway',
  )
}

main()
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('// FAIL //', msg)
    process.exitCode = 1
  })
  .finally(() => {
    // Force a clean exit. Without this, Node v22+ on Windows can hit a
    // libuv assertion on shutdown when there are pending fetch handles.
    process.exit(process.exitCode ?? 0)
  })
