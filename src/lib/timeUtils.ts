export type MeetingStatus = 'scheduling' | 'scheduled' | 'completed'

export function meetingStatusConfig(status: MeetingStatus | string): { label: string; className: string } {
  switch (status) {
    case 'scheduling':
      return {
        label: 'Scheduling',
        className:
          'border [background-color:var(--status-scheduling-bg)] [color:var(--status-scheduling-fg)] [border-color:var(--status-scheduling-border)]',
      }
    case 'scheduled':
      return {
        label: 'Scheduled',
        className:
          'border [background-color:var(--status-scheduled-bg)] [color:var(--status-scheduled-fg)] [border-color:var(--status-scheduled-border)]',
      }
    case 'completed':
      return {
        label: 'Completed',
        className:
          'border [background-color:var(--status-completed-bg)] [color:var(--status-completed-fg)] [border-color:var(--status-completed-border)]',
      }
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
