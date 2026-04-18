export type MeetingStatus = 'scheduling' | 'scheduled' | 'completed'

export function meetingStatusConfig(status: MeetingStatus | string): { label: string; className: string } {
  switch (status) {
    case 'scheduling':
      return { label: 'Scheduling', className: 'bg-yellow-100 text-yellow-800 border border-yellow-200' }
    case 'scheduled':
      return { label: 'Scheduled', className: 'bg-blue-100 text-blue-800 border border-blue-200' }
    case 'completed':
      return { label: 'Completed', className: 'bg-green-100 text-green-800 border border-green-200' }
    default:
      return { label: status, className: 'bg-muted text-muted-foreground' }
  }
}

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
