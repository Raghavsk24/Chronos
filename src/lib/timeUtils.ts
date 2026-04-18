export function utcToLocal(isoUtc: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  const d = new Date(isoUtc.endsWith('Z') ? isoUtc : isoUtc + 'Z')
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(d)
}

export function slotDate(isoUtc: string, tz: string) {
  return utcToLocal(isoUtc, tz, { weekday: 'long', month: 'long', day: 'numeric' })
}

export function slotTime(isoUtc: string, tz: string) {
  return utcToLocal(isoUtc, tz, { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function tzAbbr(isoUtc: string, tz: string) {
  return utcToLocal(isoUtc, tz, { timeZoneName: 'short' }).split(' ').pop() ?? ''
}
