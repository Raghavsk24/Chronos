import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isValidMeetingLink(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return true // empty is allowed (optional field)
  try {
    const parsed = new URL(trimmed)
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname.includes('.')
  } catch {
    return false
  }
}
