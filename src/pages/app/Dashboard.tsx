import { useEffect, useState, useCallback, useMemo } from 'react'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Users } from 'lucide-react'
import { addMonths, format, isSameDay, startOfMonth } from 'date-fns'
import type { DayButtonProps } from 'react-day-picker'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Calendar } from '@/components/ui/calendar'
import CreateLobbyModal from '@/components/CreateLobbyModal'
import CreateMeetingModal from '@/components/CreateMeetingModal'
import { slotDate, slotTime, meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'
import { cn } from '@/lib/utils'

interface Meeting {
  id: string
  lobbyId: string
  lobbyName: string
  name: string
  duration: number
  status: MeetingStatus
  scheduledSlot?: { start: string; end: string }
  createdAt?: { seconds: number }
}

interface Lobby {
  id: string
  name: string
  memberUids: string[]
}

const INITIAL_VISIBLE_MEETINGS = 5
const INITIAL_VISIBLE_LOBBIES = 5
const LOAD_MORE_STEP = 5

function parseUtcDate(iso: string): Date {
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
}

function sortedMeetings(meetings: Meeting[]): Meeting[] {
  const order: Record<MeetingStatus, number> = { scheduled: 0, scheduling: 1, completed: 2 }
  return [...meetings].sort((a, b) => {
    const orderDiff = order[a.status] - order[b.status]
    if (orderDiff !== 0) return orderDiff
    if (a.status === 'scheduled' && a.scheduledSlot && b.scheduledSlot) {
      return new Date(a.scheduledSlot.start).getTime() - new Date(b.scheduledSlot.start).getTime()
    }
    return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
  })
}

export default function Dashboard() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [userTimezone, setUserTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  )
  const [loading, setLoading] = useState(true)
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(new Date())
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const [visibleMeetingCount, setVisibleMeetingCount] = useState(INITIAL_VISIBLE_MEETINGS)
  const [visibleLobbyCount, setVisibleLobbyCount] = useState(INITIAL_VISIBLE_LOBBIES)

  const fetchData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [meetingsSnap, lobbiesSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db, 'meetings'), where('memberUids', 'array-contains', user.uid))),
        getDocs(query(collection(db, 'lobbies'), where('memberUids', 'array-contains', user.uid))),
        getDoc(doc(db, 'users', user.uid)),
      ])
      setMeetings(meetingsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting)))
      setLobbies(lobbiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lobby)))
      const tz = userSnap.data()?.settings?.timezone
      if (tz) setUserTimezone(tz)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { fetchData() }, [fetchData])

  const scheduledMeetings = useMemo(
    () => meetings.filter((m) => m.scheduledSlot && (m.status === 'scheduled' || m.status === 'completed')),
    [meetings]
  )

  const meetingDates = useMemo(
    () => scheduledMeetings.map((m) => parseUtcDate(m.scheduledSlot!.start)),
    [scheduledMeetings]
  )

  const meetingCountsByDay = useMemo(() => {
    const counts = new Map<string, number>()
    scheduledMeetings.forEach((m) => {
      const key = format(parseUtcDate(m.scheduledSlot!.start), 'yyyy-MM-dd')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return counts
  }, [scheduledMeetings])

  const dayMeetings = useMemo(() => {
    if (!selectedDay) return []
    return scheduledMeetings.filter((m) =>
      isSameDay(parseUtcDate(m.scheduledSlot!.start), selectedDay)
    )
  }, [scheduledMeetings, selectedDay])

  const selectedDayMeetingIds = useMemo(() => new Set(dayMeetings.map((m) => m.id)), [dayMeetings])

  const DayButtonWithDot = useCallback(
    ({ day, modifiers, className, ...rest }: DayButtonProps) => {
      const dayKey = format(day.date, 'yyyy-MM-dd')
      const dotCount = Math.min(meetingCountsByDay.get(dayKey) ?? 0, 3)
      return (
        <button {...rest} className={cn(className, 'relative flex flex-col items-center justify-center gap-0.5')}>
          <span>{format(day.date, 'd')}</span>
          {dotCount > 0 ? (
            <span className="flex items-center gap-0.5 h-1 shrink-0">
              {Array.from({ length: dotCount }).map((_, i) => (
                <span key={i} className="w-1 h-1 rounded-full bg-primary" />
              ))}
            </span>
          ) : <span className="w-1 h-1 shrink-0" />}
        </button>
      )
    },
    [meetingCountsByDay]
  )

  const displayMeetings = sortedMeetings(meetings)
  const visibleMeetings = useMemo(
    () => displayMeetings.slice(0, visibleMeetingCount),
    [displayMeetings, visibleMeetingCount]
  )
  const visibleLobbies = useMemo(
    () => lobbies.slice(0, visibleLobbyCount),
    [lobbies, visibleLobbyCount]
  )
  const hiddenMeetingCount = Math.max(displayMeetings.length - visibleMeetings.length, 0)
  const hiddenLobbyCount = Math.max(lobbies.length - visibleLobbies.length, 0)
  const googleCalendarDayUrl = useMemo(() => {
    const day = selectedDay ?? new Date()
    return `https://calendar.google.com/calendar/u/0/r/week/${format(day, 'yyyy/MM/dd')}`
  }, [selectedDay])

  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 md:p-6">
      <div className="min-h-full flex flex-col gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(320px,40%)_1fr]">
          <div className="min-h-0 rounded-2xl border bg-card flex flex-col overflow-hidden">
            <div className="px-4 py-3.5 md:px-5 border-b">
              <h1 className="text-lg font-semibold tracking-tight">Workspace Activity</h1>
              <p className="text-sm text-muted-foreground">Your meetings and lobbies in one place.</p>
            </div>

            <div className="p-4 md:p-5 flex flex-col gap-6">
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    My Meetings
                  </h2>
                  <CreateMeetingModal onCreated={fetchData} />
                </div>

                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />
                    ))}
                  </div>
                ) : displayMeetings.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <CalendarDays className="size-5 mx-auto text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">No meetings yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Create your first meeting to start scheduling.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visibleMeetings.map((m) => {
                      const { label, className } = meetingStatusConfig(m.status)
                      const isOnSelectedDay = selectedDayMeetingIds.has(m.id)
                      return (
                        <li key={m.id}>
                          <button
                            onClick={() => navigate(`/app/lobbies/${m.lobbyId}/meetings/${m.id}`)}
                            className={cn(
                              'w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors',
                              isOnSelectedDay
                                ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
                                : 'hover:bg-muted/40'
                            )}
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{m.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {m.scheduledSlot
                                  ? `${slotDate(m.scheduledSlot.start, userTimezone)} ${slotTime(m.scheduledSlot.start, userTimezone)}`
                                  : `${m.duration} min`}
                              </p>
                              <p className="text-xs text-muted-foreground">{m.lobbyName}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
                                {label}
                              </span>
                              <ChevronRight className="size-4 text-muted-foreground" />
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}

                {!loading && displayMeetings.length > INITIAL_VISIBLE_MEETINGS && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Showing {visibleMeetings.length} of {displayMeetings.length} meetings
                    </p>
                    <div className="flex items-center gap-2">
                      {hiddenMeetingCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setVisibleMeetingCount((prev) => prev + LOAD_MORE_STEP)}
                          className="h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          Show {Math.min(LOAD_MORE_STEP, hiddenMeetingCount)} more
                        </button>
                      )}
                      {visibleMeetings.length > INITIAL_VISIBLE_MEETINGS && (
                        <button
                          type="button"
                          onClick={() => setVisibleMeetingCount(INITIAL_VISIBLE_MEETINGS)}
                          className="h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          Collapse
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <div className="border-t" />

              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    My Lobbies
                  </h2>
                  <CreateLobbyModal onCreated={fetchData} />
                </div>

                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-14 rounded-lg border bg-muted/30 animate-pulse" />
                    ))}
                  </div>
                ) : lobbies.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <Users className="size-5 mx-auto text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">No lobbies yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Create a lobby to invite people and run meetings.</p>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visibleLobbies.map((l) => (
                      <li key={l.id}>
                        <button
                          onClick={() => navigate(`/app/lobbies/${l.id}`)}
                          className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{l.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {l.memberUids.length} member{l.memberUids.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {!loading && lobbies.length > INITIAL_VISIBLE_LOBBIES && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Showing {visibleLobbies.length} of {lobbies.length} lobbies
                    </p>
                    <div className="flex items-center gap-2">
                      {hiddenLobbyCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setVisibleLobbyCount((prev) => prev + LOAD_MORE_STEP)}
                          className="h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          Show {Math.min(LOAD_MORE_STEP, hiddenLobbyCount)} more
                        </button>
                      )}
                      {visibleLobbies.length > INITIAL_VISIBLE_LOBBIES && (
                        <button
                          type="button"
                          onClick={() => setVisibleLobbyCount(INITIAL_VISIBLE_LOBBIES)}
                          className="h-7 px-2.5 rounded-md border border-input text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          Collapse
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>

          <div className="min-h-0 rounded-2xl border bg-card flex flex-col overflow-hidden">
            <div className="px-4 py-3.5 md:px-5 border-b shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Calendar</h2>
                  <p className="text-sm text-muted-foreground">Track scheduled and completed events by day.</p>
                </div>
                <div className="text-right flex flex-col items-end gap-2">
                  <p className="text-sm font-medium">
                    {selectedDay ? `${format(selectedDay, 'MMM d')} · ${dayMeetings.length} meeting${dayMeetings.length !== 1 ? 's' : ''}` : 'No day selected'}
                  </p>
                  <a
                    href={googleCalendarDayUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="h-6 px-2 rounded-md border border-input text-[11px] font-medium inline-flex items-center hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    Open Google Calendar
                  </a>
                </div>
              </div>

              <div className="mt-4">
                <div className="grid grid-cols-7 items-center mb-2">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setCalendarMonth((prev) => addMonths(prev, -1))}
                    className="col-start-1 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="col-start-2 col-end-7 text-center text-base font-semibold">
                    {format(calendarMonth, 'MMMM yyyy')}
                  </div>
                  <button
                    type="button"
                    aria-label="Next month"
                    onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}
                    className="col-start-7 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <Calendar
                  mode="single"
                  selected={selectedDay}
                  onSelect={(date) => {
                    setSelectedDay(date)
                    if (date) setCalendarMonth(startOfMonth(date))
                  }}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  className="w-full"
                  classNames={{
                    months: 'w-full',
                    month: 'w-full',
                    month_caption: 'hidden',
                    caption_label: 'hidden',
                    nav: 'hidden',
                    weekdays: 'grid grid-cols-7 w-full',
                    weekday: 'text-muted-foreground font-normal text-xs text-center py-1',
                    weeks: 'flex flex-col gap-2 w-full',
                    week: 'grid grid-cols-7 w-full',
                    day: 'flex items-center justify-center',
                    day_button: cn(
                      'w-full h-11 md:h-12 p-0 font-normal text-sm inline-flex flex-col items-center justify-center rounded-lg',
                      'hover:bg-accent hover:text-accent-foreground transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    ),
                    selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground rounded-lg',
                    today: 'bg-accent text-accent-foreground rounded-lg',
                    outside: 'text-muted-foreground opacity-40',
                    disabled: 'text-muted-foreground opacity-30 pointer-events-none',
                  }}
                  components={{ DayButton: DayButtonWithDot }}
                />
              </div>
            </div>

            <div className="px-4 pb-4 pt-3 md:px-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {selectedDay ? format(selectedDay, 'EEEE, MMMM d') : 'Select a day'}
                </h3>
                {selectedDay && (
                  <span className="text-xs text-muted-foreground">
                    {dayMeetings.length} meeting{dayMeetings.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {!selectedDay ? (
                <p className="text-sm text-muted-foreground">Select a date to see matching meetings.</p>
              ) : dayMeetings.length === 0 ? (
                <div className="rounded-lg border border-dashed p-5 text-center">
                  <p className="text-sm font-medium">No meetings on this day</p>
                  <p className="text-xs text-muted-foreground mt-1">Try a different date or create a new meeting.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dayMeetings.map((m) => {
                    const { label, className } = meetingStatusConfig(m.status)
                    return (
                      <li key={m.id}>
                        <button
                          onClick={() => navigate(`/app/lobbies/${m.lobbyId}/meetings/${m.id}`)}
                          className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{m.name}</p>
                            {m.scheduledSlot && (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {slotTime(m.scheduledSlot.start, userTimezone)}
                                {' - '}
                                {slotTime(m.scheduledSlot.end, userTimezone)}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">{m.lobbyName}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
                              {label}
                            </span>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
