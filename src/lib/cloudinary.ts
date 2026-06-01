// Tiny Cloudinary uploader. Just enough to upload a PNG buffer and
// get back a public URL. We don't need the SDK — Cloudinary's REST
// API works fine via fetch.
//
// Auth: signed uploads with our API key + secret. Signed (not unsigned)
// because unsigned uploads need an "upload preset" pre-configured on
// Cloudinary's dashboard, which is one more setup step we can skip.

import { createHash } from 'node:crypto'
import { env } from '../env.js'
import { log } from './log.js'

type CloudinaryUploadResult = {
  secure_url: string
  public_id: string
}

export class CloudinaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CloudinaryError'
  }
}

/**
 * Upload a PNG buffer to Cloudinary. Returns the public HTTPS URL.
 * Throws CloudinaryError on any failure.
 */
export async function uploadMatchupImage(
  pngBuffer: Buffer,
  publicIdHint: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const folder = 'playchart-matchups'

  // Cloudinary requires a SHA1 of the parameters being signed,
  // alphabetized, joined with &, ending with the API secret.
  // Public ID format: folder/matchup_<gameAId>_<gameBId>_<timestamp>
  const publicId = `${folder}/${publicIdHint}_${timestamp}`
  const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`
  const signature = createHash('sha1')
    .update(paramsToSign + env.cloudinaryApiSecret)
    .digest('hex')

  // Build multipart form. Cloudinary needs the file part to use the
  // form-data API — we construct it via the global FormData (Node 20+).
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(pngBuffer)], { type: 'image/png' }))
  form.append('api_key', env.cloudinaryApiKey)
  form.append('timestamp', String(timestamp))
  form.append('signature', signature)
  form.append('public_id', publicId)

  const url = `https://api.cloudinary.com/v1_1/${env.cloudinaryCloudName}/image/upload`
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(15000), // 15s — image upload can be slow
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    log.error(`cloudinary upload failed: ${res.status} ${text.slice(0, 300)}`)
    throw new CloudinaryError(`upload failed: ${res.status}`)
  }

  const data = (await res.json()) as CloudinaryUploadResult
  log.info(`cloudinary uploaded // ${data.secure_url}`)
  return data.secure_url
}
