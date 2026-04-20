import { useEffect, useState, useCallback, useMemo } from 'react'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
    () => scheduledMeetings.map((m) => new Date(
      m.scheduledSlot!.start.endsWith('Z') ? m.scheduledSlot!.start : m.scheduledSlot!.start + 'Z'
    )),
    [scheduledMeetings]
  )

  const dayMeetings = useMemo(() => {
    if (!selectedDay) return []
    return scheduledMeetings.filter((m) =>
      isSameDay(
        new Date(m.scheduledSlot!.start.endsWith('Z') ? m.scheduledSlot!.start : m.scheduledSlot!.start + 'Z'),
        selectedDay
      )
    )
  }, [scheduledMeetings, selectedDay])

  const DayButtonWithDot = useCallback(
    ({ day, modifiers, className, ...rest }: DayButtonProps) => {
      const hasMeeting = meetingDates.some((d) => isSameDay(d, day.date))
      return (
        <button {...rest} className={cn(className, 'relative flex flex-col items-center justify-center gap-0.5')}>
          <span>{format(day.date, 'd')}</span>
          {hasMeeting ? (
            <span className="w-1 h-1 rounded-full bg-primary shrink-0" />
          ) : (
            <span className="w-1 h-1 shrink-0" />
          )}
        </button>
      )
    },
    [meetingDates]
  )

  const displayMeetings = sortedMeetings(meetings)

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left panel */}
      <div className="w-[38%] border-r flex flex-col overflow-hidden shrink-0">
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* My Meetings */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                My Meetings
              </h2>
              <CreateMeetingModal onCreated={fetchData} />
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : displayMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {displayMeetings.map((m) => {
                  const { label, className } = meetingStatusConfig(m.status)
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => navigate(`/app/lobbies/${m.lobbyId}/meetings/${m.id}`)}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
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
          </section>

          <div className="border-t" />

          {/* My Lobbies */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                My Lobbies
              </h2>
              <CreateLobbyModal onCreated={fetchData} />
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : lobbies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lobbies yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {lobbies.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => navigate(`/app/lobbies/${l.id}`)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
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
          </section>
        </div>
      </div>

      {/* Right panel — Calendar */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Calendar */}
        <div className="flex items-start justify-center pt-4 px-6 shrink-0">
          <div className="w-full">
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
                  'w-full h-12 p-0 font-normal text-sm inline-flex flex-col items-center justify-center rounded-lg',
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

        {/* Selected day events */}
        <div className="border-t mt-3 flex flex-col overflow-hidden">
          <div className="px-6 py-3 shrink-0">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              {selectedDay ? format(selectedDay, 'EEEE, MMMM d') : 'Select a day'}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto px-6 pb-4">
            {!selectedDay ? (
              <p className="text-sm text-muted-foreground">Click a day to see meetings.</p>
            ) : dayMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings on this day.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {dayMeetings.map((m) => {
                  const { label, className } = meetingStatusConfig(m.status)
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => navigate(`/app/lobbies/${m.lobbyId}/meetings/${m.id}`)}
                        className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{m.name}</p>
                          {m.scheduledSlot && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {slotTime(m.scheduledSlot.start, userTimezone)}
                              {' — '}
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
  )
}
