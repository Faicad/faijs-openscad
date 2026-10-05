import { createHash } from 'node:crypto'

/**
 * sha256 of CSG text. Used by the corpus manifest so a silent corpus change is
 * a test failure instead of an invisible drift.
 *
 * Node-only: `browser.ts` must not re-export this module.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function sha256HexOfBuffer(buf: Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex')
}
