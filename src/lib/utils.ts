import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const MEETING_LINK_PATTERNS = [
  /meet\.google\.com\//i,
  /zoom\.us\/(j|my)\//i,
  /teams\.microsoft\.com\//i,
  /teams\.live\.com\//i,
  /webex\.com\//i,
  /gotomeeting\.com\/join\//i,
  /join\.skype\.com\//i,
  /whereby\.com\//i,
  /discord\.gg\//i,
  /discord\.com\/channels\//i,
  /bluejeans\.com\//i,
  /chime\.aws\//i,
  /join\.me\//i,
]

export function isValidMeetingLink(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return true // empty is allowed (optional field)
  try {
    const parsed = new URL(trimmed)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    return MEETING_LINK_PATTERNS.some((pattern) => pattern.test(trimmed))
  } catch {
    return false
  }
}
