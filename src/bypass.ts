/**
 * Bypass module — runtime-only compression toggle.
 *
 * When bypass is ON, requests pass through uncompressed but still logged.
 * Resets on process restart. Does not touch config files.
 */

let bypassed = false

export function isBypassed(): boolean {
  return bypassed
}

export function setBypassed(val: boolean): void {
  bypassed = val
  console.log(`[squeezr] Bypass mode ${val ? 'ON — compression disabled' : 'OFF — compression active'}`)
}

export function toggleBypassed(): boolean {
  setBypassed(!bypassed)
  return bypassed
}
