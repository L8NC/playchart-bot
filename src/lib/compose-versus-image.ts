// Composes the weekly matchup card by drawing two game covers onto
// the brand-designed background.
//
// Background image:    assets/versus-bg.png  (1200x675 RGBA)
// Slot A (left):        (138, 154) — 314 x 398
// Slot B (right):       (747, 158) — 313 x 392
//
// Layer order: background first, covers drawn on top. The slot
// interiors in the background aren't transparent, so we can't put
// the background on top to overlay its glow on cover edges.
// If we ever swap in a background with transparent slot interiors,
// flip the order.
//
// Covers come from IGDB via BP's API. We fetch them, resize to fill
// each slot (cover-fit cropping so the slot is always fully covered),
// then composite onto the background. Output: PNG buffer.
//
// Uses @napi-rs/canvas — fast, prebuilt binaries, plays nicely on
// Railway. We deliberately avoid `canvas` (the older library) because
// it requires native build deps that bloat the container.

import { createCanvas, loadImage, type Image } from '@napi-rs/canvas'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { log } from './log.js'

// Slot positions, measured from the actual background design.
// If the background art changes, re-measure and update these.
const CANVAS_WIDTH = 1200
const CANVAS_HEIGHT = 675

const SLOT_A = { x: 138, y: 154, w: 314, h: 398 } // left
const SLOT_B = { x: 747, y: 158, w: 313, h: 392 } // right

// Path to the background image, resolved relative to this source file.
// At runtime in production, the file lives next to the compiled .js
// in `dist/lib/` — we keep the asset alongside it via a build copy step
// (see package.json build script).
const __dirname = dirname(fileURLToPath(import.meta.url))
const BG_PATH = join(__dirname, '..', 'assets', 'versus-bg.png')

// Cache the background bytes after first load. The file never changes
// at runtime; reading it once is enough.
let bgBytesCache: Buffer | null = null

async function getBgBytes(): Promise<Buffer> {
  if (bgBytesCache) return bgBytesCache
  bgBytesCache = await readFile(BG_PATH)
  return bgBytesCache
}

/**
 * Fetch a cover image URL into bytes. Returns null on any failure —
 * the caller will draw a placeholder for missing covers.
 */
async function fetchCoverBytes(url: string | null): Promise<Buffer | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      log.warn(`cover fetch failed ${res.status}: ${url}`)
      return null
    }
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    log.warn(`cover fetch errored: ${url}`)
    return null
  }
}

/**
 * Draw an image into a slot using object-fit: cover semantics —
 * scale to fully cover the slot, crop the overflow, center.
 */
function drawCover(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  img: Image,
  slot: { x: number; y: number; w: number; h: number },
): void {
  const slotAspect = slot.w / slot.h
  const imgAspect = img.width / img.height

  let sx = 0
  let sy = 0
  let sw = img.width
  let sh = img.height

  if (imgAspect > slotAspect) {
    // image wider than slot — crop sides
    sw = img.height * slotAspect
    sx = (img.width - sw) / 2
  } else {
    // image taller than slot — crop top/bottom
    sh = img.width / slotAspect
    sy = (img.height - sh) / 2
  }

  ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.w, slot.h)
}

/**
 * Placeholder when a cover URL is missing or fetch failed. Solid dark
 * fill with a label — visually consistent with the slot frame.
 */
function drawPlaceholder(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  slot: { x: number; y: number; w: number; h: number },
): void {
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(slot.x, slot.y, slot.w, slot.h)
  ctx.fillStyle = '#444'
  ctx.font = 'bold 20px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('NO COVER', slot.x + slot.w / 2, slot.y + slot.h / 2)
}

/**
 * Compose the matchup card PNG.
 * Returns a Buffer ready to attach to a Discord message.
 */
export async function composeVersusImage(input: {
  coverAUrl: string | null
  coverBUrl: string | null
}): Promise<Buffer> {
  // Parallel fetch: background bytes + both covers.
  const [bgBytes, coverABytes, coverBBytes] = await Promise.all([
    getBgBytes(),
    fetchCoverBytes(input.coverAUrl),
    fetchCoverBytes(input.coverBUrl),
  ])

  // Decode everything.
  const [bgImg, coverAImg, coverBImg] = await Promise.all([
    loadImage(bgBytes),
    coverABytes ? loadImage(coverABytes).catch(() => null) : Promise.resolve(null),
    coverBBytes ? loadImage(coverBBytes).catch(() => null) : Promise.resolve(null),
  ])

  const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  const ctx = canvas.getContext('2d')

  // Background FIRST — fills the entire canvas.
  ctx.drawImage(bgImg, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // Covers ON TOP — they sit inside the slot frames in the design.
  if (coverAImg) drawCover(ctx, coverAImg, SLOT_A)
  else drawPlaceholder(ctx, SLOT_A)

  if (coverBImg) drawCover(ctx, coverBImg, SLOT_B)
  else drawPlaceholder(ctx, SLOT_B)

  return canvas.encode('png')
}
