export const ALLOWED_COLORS = [
  '#FFD7D2',
  '#FFC6A4',
  '#FFB7B7',
  '#D8C2E2',
  '#C9D9D1',
] as const

const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const AVATAR_PATTERN =
  /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function isValidAvatarDataUrl(value: string): boolean {
  if (!value) return true
  const encoded = value.split(',')[1] || ''
  return (
    AVATAR_PATTERN.test(value) &&
    Buffer.byteLength(encoded, 'base64') <= MAX_AVATAR_BYTES
  )
}

export function normalizeColor(value: string): string {
  return ALLOWED_COLORS.includes(value as (typeof ALLOWED_COLORS)[number])
    ? value
    : ALLOWED_COLORS[0]
}
