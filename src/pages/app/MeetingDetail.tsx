import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { arrayRemove, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink, CheckCircle2, Settings, Trash2, LogOut, RotateCcw, X } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { slotDate, slotTime, tzAbbr, meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'

interface Member {
  uid: string
  displayName: string
  email: string
  photoURL: string
}

type FirestoreTimestampLike =
  | { seconds: number }
  | { toDate: () => Date }
  | Date
  | string
  | number
  | null
  | undefined

function formatDate(createdAt: FirestoreTimestampLike): string {
  if (!createdAt) return '—'

  let d: Date | null = null
  if (createdAt instanceof Date) d = createdAt
  else if (typeof createdAt === 'string' || typeof createdAt === 'number') d = new Date(createdAt)
  else if (typeof (createdAt as { toDate?: () => Date }).toDate === 'function') {
    d = (createdAt as { toDate: () => Date }).toDate()
  } else if (typeof (createdAt as { seconds?: number }).seconds === 'number') {
    d = new Date((createdAt as { seconds: number }).seconds * 1000)
  }

  if (!d || Number.isNaN(d.getTime())) return '—'

  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

interface Meeting {
  id: string
  lobbyId: string
  lobbyName: string
  name: string
  description?: string
  duration: number
  meetingLink?: string
  status: MeetingStatus
  scheduledSlot?: { start: string; end: string } | null
  hostUid: string
  hostName: string
  memberUids?: string[]
  members?: Member[]
  createdAt?: FirestoreTimestampLike
  preferences?: {
    dayPart?: 'morning' | 'midday' | 'afternoon'
    targetDates?: string[]
    extraBuffer?: boolean
  } | null
}

type DayPart = 'morning' | 'midday' | 'afternoon'

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return format(new Date(Number(y), Number(m) - 1, Number(d)), 'MMM d, yyyy')
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

interface Slot {
  start: string
  end: string
  score: number
  position_score: number
  buffer_score: number
  buffer_score_avg: number
}

const scheduleMeeting = httpsCallable(functions, 'schedule_meeting')
const bookMeeting = httpsCallable(functions, 'book_meeting')

export default function MeetingDetail() {
  const { lobbyId, meetingId } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [loading, setLoading] = useState(true)
  const [userTimezone, setUserTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  // Scheduling
  const [finding, setFinding] = useState(false)
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [scheduleError, setScheduleError] = useState('')
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [completing, setCompleting] = useState(false)
  const [rebooking, setRebooking] = useState(false)

  // Meeting settings
  const [showSettings, setShowSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsForm, setSettingsForm] = useState({
    name: '',
    description: '',
    duration: '60',
    meetingLink: '',
  })
  const [dayPart, setDayPart] = useState<DayPart | null>(null)
  const [targetingDate, setTargetingDate] = useState(false)
  const [targetDates, setTargetDates] = useState<string[]>([])
  const [selectedTargetDate, setSelectedTargetDate] = useState<Date>(() => new Date())
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date())
  const [extraBuffer, setExtraBuffer] = useState(false)

  // Delete / leave
  const [showDelete, setShowDelete] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [acting, setActing] = useState(false)

  const fetchMeeting = useCallback(async () => {
    if (!meetingId || !user) return
    const [meetingSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'meetings', meetingId)),
      getDoc(doc(db, 'users', user.uid)),
    ])
    if (!meetingSnap.exists()) { navigate(`/app/lobbies/${lobbyId}`); return }
    setMeeting({ id: meetingSnap.id, ...meetingSnap.data() } as Meeting)
    const tz = userSnap.data()?.settings?.timezone
    if (tz) setUserTimezone(tz)
    setLoading(false)
  }, [meetingId, user])

  useEffect(() => { fetchMeeting() }, [fetchMeeting])

  const handleFindSlots = async () => {
    if (!meeting) return
    setFinding(true)
    setSlots([])
    setSelectedSlot(null)
    setScheduleError('')
    try {
      const result = await scheduleMeeting({ meetingId: meeting.id })
      const data = result.data as { slots?: Slot[]; error?: string }
      if (data.error) {
        setScheduleError(data.error)
      } else {
        setSlots(data.slots ?? [])
        if (!data.slots?.length) setScheduleError('No available slots found in the next 4 weeks.')
      }
    } catch (err: unknown) {
      setScheduleError(err instanceof Error ? err.message : 'Failed to find meeting times.')
    } finally {
      setFinding(false)
    }
  }

  const handleBook = async () => {
    if (!meeting || !selectedSlot) return
    setBooking(true)
    setBookingError('')
    try {
      await bookMeeting({
        meetingId: meeting.id,
        slotStart: selectedSlot.start,
        slotEnd: selectedSlot.end,
      })
      setMeeting({ ...meeting, status: 'scheduled', scheduledSlot: { start: selectedSlot.start, end: selectedSlot.end } })
      setSlots([])
      setSelectedSlot(null)
      toast.success('Meeting booked! Calendar invites sent to all members.')
    } catch (err: unknown) {
      setBookingError(err instanceof Error ? err.message : 'Failed to book meeting.')
    } finally {
      setBooking(false)
    }
  }

  const handleMarkComplete = async () => {
    if (!meeting) return
    setCompleting(true)
    try {
      await updateDoc(doc(db, 'meetings', meeting.id), { status: 'completed' })
      setMeeting({ ...meeting, status: 'completed' })
      toast.success('Meeting marked as complete.')
    } catch {
      toast.error('Failed to mark meeting as complete.')
    } finally {
      setCompleting(false)
    }
  }

  const handleRebook = async () => {
    if (!meeting) return
    setRebooking(true)
    try {
      await updateDoc(doc(db, 'meetings', meeting.id), {
        status: 'scheduling',
        scheduledSlot: null,
      })
      setMeeting({ ...meeting, status: 'scheduling', scheduledSlot: null })
      setSlots([])
      setSelectedSlot(null)
      setScheduleError('')
      setBookingError('')
      toast.success('Meeting reset for rebooking.')
    } catch {
      toast.error('Failed to reset meeting for rebooking.')
    } finally {
      setRebooking(false)
    }
  }

  const handleDeleteMeeting = async () => {
    if (!meeting) return
    setActing(true)
    try {
      await deleteDoc(doc(db, 'meetings', meeting.id))
      toast.success('Meeting deleted.')
      navigate(`/app/lobbies/${lobbyId}`)
    } catch {
      toast.error('Failed to delete meeting.')
      setActing(false)
    }
  }

  const openSettings = () => {
    if (!meeting) return
    setSettingsForm({
      name: meeting.name,
      description: meeting.description ?? '',
      duration: String(meeting.duration),
      meetingLink: meeting.meetingLink ?? '',
    })
    setDayPart(meeting.preferences?.dayPart ?? null)
    setTargetDates(meeting.preferences?.targetDates ?? [])
    setTargetingDate(Boolean(meeting.preferences?.targetDates?.length))
    setExtraBuffer(Boolean(meeting.preferences?.extraBuffer))
    const initialDate = meeting.preferences?.targetDates?.[0]
      ? new Date(`${meeting.preferences.targetDates[0]}T00:00:00`)
      : new Date()
    setSelectedTargetDate(initialDate)
    setCalendarMonth(initialDate)
    setShowSettings(true)
  }

  const addTargetDate = () => {
    const iso = toIsoDate(selectedTargetDate)
    if (!targetDates.includes(iso)) setTargetDates((prev) => [...prev, iso])
  }

  const handleSaveSettings = async () => {
    if (!meeting || !settingsForm.name.trim()) return
    setSavingSettings(true)
    try {
      const payload = {
        name: settingsForm.name.trim(),
        description: settingsForm.description.trim() || null,
        duration: Number(settingsForm.duration),
        meetingLink: settingsForm.meetingLink.trim() || null,
        preferences: (() => {
          const p: Record<string, unknown> = {}
          if (dayPart) p.dayPart = dayPart
          if (targetingDate && targetDates.length > 0) p.targetDates = targetDates
          if (extraBuffer) p.extraBuffer = true
          return Object.keys(p).length > 0 ? p : null
        })(),
      }
      await updateDoc(doc(db, 'meetings', meeting.id), payload)
      setMeeting({
        ...meeting,
        name: payload.name,
        description: payload.description ?? undefined,
        duration: payload.duration,
        meetingLink: payload.meetingLink ?? undefined,
        preferences: (payload.preferences as Meeting['preferences']) ?? null,
      })
      toast.success('Meeting settings updated.')
      setShowSettings(false)
    } catch {
      toast.error('Failed to update meeting settings.')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleLeaveMeeting = async () => {
    if (!meeting || !user) return
    setActing(true)
    try {
      const me = meeting.members?.find((m) => m.uid === user.uid)
      if (me) {
        await updateDoc(doc(db, 'meetings', meeting.id), {
          memberUids: arrayRemove(user.uid),
          members: arrayRemove(me),
        })
      } else {
        await updateDoc(doc(db, 'meetings', meeting.id), {
          memberUids: arrayRemove(user.uid),
        })
      }
      toast.success('You left the meeting.')
      navigate(`/app/lobbies/${lobbyId}`)
    } catch {
      toast.error('Failed to leave meeting.')
      setActing(false)
    }
  }

  if (loading) return <div className="p-8"><p className="text-muted-foreground">Loading meeting...</p></div>
  if (!meeting) return null

  const isHost = user?.uid === meeting.hostUid

  const statusBadge = (() => {
    const { label, className } = meetingStatusConfig(meeting.status)
    return (
      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${className}`}>
        {label}
      </span>
    )
  })()

  return (
    <div className="flex flex-col min-h-full">
      {/* Sticky top nav */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate(`/app/lobbies/${lobbyId}`)}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
          <span className="text-sm">Back to Lobby</span>
        </button>
        {isHost ? (
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)} className="shrink-0">
            <Trash2 className="size-3.5 mr-1.5" />
            Delete Meeting
          </Button>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setShowLeave(true)} className="shrink-0">
            <LogOut className="size-3.5 mr-1.5" />
            Leave Meeting
          </Button>
        )}
      </div>

      {/* Meeting overview */}
      <div className="px-8 py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight min-w-0 break-words">{meeting.name}</h1>
            {isHost && (
              <button
                onClick={openSettings}
                className="shrink-0 inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground transition-colors"
                title="Meeting settings"
                aria-label="Meeting settings"
              >
                <Settings className="size-4" />
              </button>
            )}
          </div>
          <div className="shrink-0 pt-1">{statusBadge}</div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {[
            { label: 'Lobby', value: meeting.lobbyName },
            { label: 'Date Created', value: formatDate(meeting.createdAt) },
            { label: 'Host', value: meeting.hostName },
          ].map(({ label, value }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs"
            >
              <span className="font-semibold text-black">{label}:</span>
              <span className="text-black">{value}</span>
            </span>
          ))}
        </div>
        {meeting.description && (
          <p className="text-sm text-muted-foreground mt-3">{meeting.description}</p>
        )}
        {meeting.meetingLink && (
          <a
            href={meeting.meetingLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-3"
          >
            <ExternalLink className="size-3.5" />
            Meeting link
          </a>
        )}
      </div>

      {/* Schedule block (directly below overview) */}
      <div className="px-8 pb-8">
        <div className="border rounded-xl p-5 flex flex-col gap-4">
        {meeting.status === 'completed' && meeting.scheduledSlot ? (
          <div>
            <h2 className="font-semibold mb-1">Meeting completed</h2>
            <p className="text-sm text-muted-foreground">
              {slotDate(meeting.scheduledSlot.start, userTimezone)}{' '}
              {slotTime(meeting.scheduledSlot.start, userTimezone)}
              {' – '}
              {slotTime(meeting.scheduledSlot.end, userTimezone)}{' '}
              ({tzAbbr(meeting.scheduledSlot.start, userTimezone)})
            </p>
          </div>
        ) : meeting.status === 'scheduled' && meeting.scheduledSlot ? (
          <div className="flex flex-col gap-3">
            <div>
              <h2 className="font-semibold mb-1">Meeting scheduled</h2>
              <p className="text-sm text-muted-foreground">
                {slotDate(meeting.scheduledSlot.start, userTimezone)}{' '}
                {slotTime(meeting.scheduledSlot.start, userTimezone)}
                {' – '}
                {slotTime(meeting.scheduledSlot.end, userTimezone)}{' '}
                ({tzAbbr(meeting.scheduledSlot.start, userTimezone)})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Calendar invites were sent to all members.
              </p>
            </div>
            {isHost && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-green-700 border-green-200 hover:bg-green-50"
                  onClick={handleMarkComplete}
                  disabled={completing || rebooking}
                >
                  <CheckCircle2 className="size-4" />
                  {completing ? 'Marking...' : 'Mark as Complete'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-blue-700 border-blue-200 hover:bg-blue-50"
                  onClick={handleRebook}
                  disabled={rebooking || completing}
                >
                  <RotateCcw className="size-4" />
                  {rebooking ? 'Rebooking...' : "Didn't like the timing? Rebook meeting"}
                </Button>
              </div>
            )}
          </div>
        ) : isHost ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">Find a meeting time</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Searches everyone's Google Calendar for the next 4 weeks.
                </p>
              </div>
              <div className="shrink-0">
                <Button onClick={handleFindSlots} disabled={finding || booking}>
                  {finding ? 'Searching...' : 'Find Meeting Times'}
                </Button>
              </div>
            </div>

            {scheduleError && <p className="text-sm text-destructive">{scheduleError}</p>}

            {slots.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">Select a time to book:</p>
                {slots.map((slot, i) => {
                  const isSelected = selectedSlot?.start === slot.start
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedSlot(slot)}
                      className={`w-full text-left rounded-lg border p-4 transition-colors ${
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-accent'
                      }`}
                    >
                      <p className="font-medium text-sm">{slotDate(slot.start, userTimezone)}</p>
                      <p className="text-sm text-muted-foreground">
                        {slotTime(slot.start, userTimezone)} – {slotTime(slot.end, userTimezone)}{' '}
                        ({tzAbbr(slot.start, userTimezone)})
                      </p>
                    </button>
                  )
                })}

                {selectedSlot && (
                  <>
                    {bookingError && <p className="text-sm text-destructive">{bookingError}</p>}
                    <Button className="mt-2 w-full" onClick={handleBook} disabled={booking}>
                      {booking
                        ? 'Booking...'
                        : `Confirm – ${slotDate(selectedSlot.start, userTimezone)} ${slotTime(selectedSlot.start, userTimezone)}`}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div>
            <h2 className="font-semibold mb-1">Awaiting scheduling</h2>
            <p className="text-sm text-muted-foreground">
              The host will find and confirm a meeting time.
            </p>
          </div>
        )}
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-3xl w-[96vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{meeting.name} Settings</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Meeting name</label>
              <Input
                value={settingsForm.name}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Meeting name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <textarea
                rows={6}
                value={settingsForm.description}
                onChange={(e) => setSettingsForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What is this meeting about?"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Duration</label>
                <select
                  value={settingsForm.duration}
                  onChange={(e) => setSettingsForm((prev) => ({ ...prev, duration: e.target.value }))}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="30">30 min</option>
                  <option value="60">1 hour</option>
                  <option value="90">1.5 hours</option>
                  <option value="120">2 hours</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Meeting link</label>
                <Input
                  type="url"
                  value={settingsForm.meetingLink}
                  onChange={(e) => setSettingsForm((prev) => ({ ...prev, meetingLink: e.target.value }))}
                  placeholder="https://meet.google.com/..."
                />
              </div>
            </div>

            <div className="border-t" />

            <div className="flex flex-col gap-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Scheduling Preferences</p>

              <div className="flex flex-col gap-1.5">
                <Label>Preferred time of day</Label>
                <div className="flex gap-2">
                  {[
                    { value: 'morning', label: 'Morning' },
                    { value: 'midday', label: 'Midday' },
                    { value: 'afternoon', label: 'Afternoon' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDayPart((prev) => prev === value ? null : value as DayPart)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        dayPart === value
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label>Targeting a specific date?</Label>
                  <button
                    type="button"
                    onClick={() => setTargetingDate((v) => !v)}
                    className={`relative inline-flex h-5 w-9 rounded-full border border-transparent transition-colors ${
                      targetingDate ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        targetingDate ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {targetingDate && (
                  <div className="flex flex-col gap-2">
                    <div className="rounded-xl border bg-popover p-2.5 shadow-md">
                      <div className="grid grid-cols-7 items-center gap-1 mb-0.5">
                        <button
                          type="button"
                          aria-label="Previous month"
                          onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                          className="col-start-1 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          <span className="text-lg leading-none">‹</span>
                        </button>
                        <div className="col-start-2 col-end-7 flex items-center justify-center gap-1">
                          <Select
                            value={String(calendarMonth.getMonth())}
                            onValueChange={(value) => setCalendarMonth((prev) => new Date(prev.getFullYear(), Number(value), 1))}
                          >
                            <SelectTrigger className="h-8 w-[114px]">
                              <span className="truncate">{format(calendarMonth, 'MMMM')}</span>
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 12 }, (_, i) => format(new Date(2020, i, 1), 'MMMM')).map((label, i) => (
                                <SelectItem key={label} value={String(i)}>{label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={String(calendarMonth.getFullYear())}
                            onValueChange={(value) => setCalendarMonth((prev) => new Date(Number(value), prev.getMonth(), 1))}
                          >
                            <SelectTrigger className="h-8 w-[88px]">
                              <SelectValue placeholder={String(calendarMonth.getFullYear())} />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: new Date().getFullYear() - 1920 + 1 }, (_, i) => String(1920 + i)).map((year) => (
                                <SelectItem key={year} value={year}>{year}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <button
                          type="button"
                          aria-label="Next month"
                          onClick={() => setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
                          className="col-start-7 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          <span className="text-lg leading-none">›</span>
                        </button>
                      </div>
                      <Calendar
                        mode="single"
                        selected={selectedTargetDate}
                        onSelect={(date) => {
                          if (date) {
                            setSelectedTargetDate(date)
                            setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1))
                          }
                        }}
                        month={calendarMonth}
                        onMonthChange={setCalendarMonth}
                        className="w-full p-0"
                        classNames={{
                          month_caption: 'hidden',
                          caption_label: 'hidden',
                          nav: 'hidden',
                          months: 'w-full',
                          month: 'w-full',
                          weekdays: 'grid grid-cols-7 w-full',
                          weekday: 'text-muted-foreground font-normal text-xs text-center py-0.5',
                          weeks: 'flex flex-col gap-1 w-full',
                          week: 'grid grid-cols-7 w-full',
                          day: 'flex items-center justify-center',
                          day_button: 'w-full h-11 p-0 font-normal text-sm inline-flex items-center justify-center rounded-lg',
                          selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-lg',
                          today: 'bg-accent text-accent-foreground rounded-lg',
                          outside: 'text-muted-foreground opacity-40',
                        }}
                      />
                      <Button variant="outline" onClick={addTargetDate} className="mt-2 w-full">
                        Add
                      </Button>
                    </div>
                    {targetDates.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {targetDates.map((iso) => (
                          <Badge key={iso} variant="secondary" className="gap-1 text-xs">
                            {formatDisplayDate(iso)}
                            <button
                              type="button"
                              onClick={() => setTargetDates((prev) => prev.filter((d) => d !== iso))}
                              className="hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Add 30-min buffer</Label>
                  <p className="text-xs text-muted-foreground">In case the meeting runs over</p>
                </div>
                <button
                  type="button"
                  onClick={() => setExtraBuffer((v) => !v)}
                  className={`relative inline-flex h-5 w-9 rounded-full border border-transparent transition-colors ${
                    extraBuffer ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      extraBuffer ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)} disabled={savingSettings}>Cancel</Button>
            <Button onClick={handleSaveSettings} disabled={!settingsForm.name.trim() || savingSettings}>
              {savingSettings ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete meeting?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{meeting.name}</strong>. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={acting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteMeeting} disabled={acting}>
              {acting ? 'Deleting...' : 'Delete meeting'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirmation */}
      <Dialog open={showLeave} onOpenChange={setShowLeave}>
        <DialogContent>
          <DialogHeader><DialogTitle>Leave meeting?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You will be removed from <strong>{meeting.name}</strong> and lose access to its details.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeave(false)} disabled={acting}>Cancel</Button>
            <Button variant="destructive" onClick={handleLeaveMeeting} disabled={acting}>
              {acting ? 'Leaving...' : 'Leave meeting'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
