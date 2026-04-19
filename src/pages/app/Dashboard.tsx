import { useEffect, useState, useCallback } from 'react'
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventClickArg } from '@fullcalendar/core'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import CreateLobbyModal from '@/components/CreateLobbyModal'
import CreateMeetingModal from '@/components/CreateMeetingModal'
import { slotDate, slotTime, meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'

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
    const aTs = a.createdAt?.seconds ?? 0
    const bTs = b.createdAt?.seconds ?? 0
    return bTs - aTs
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

  const displayMeetings = sortedMeetings(meetings)

  const calendarEvents = meetings
    .filter((m) => (m.status === 'scheduled' || m.status === 'completed') && m.scheduledSlot)
    .map((m) => ({
      id: m.id,
      title: m.name,
      start: m.scheduledSlot!.start.endsWith('Z') ? m.scheduledSlot!.start : m.scheduledSlot!.start + 'Z',
      end: m.scheduledSlot!.end.endsWith('Z') ? m.scheduledSlot!.end : m.scheduledSlot!.end + 'Z',
      extendedProps: { lobbyId: m.lobbyId },
      classNames: m.status === 'completed' ? ['opacity-60'] : [],
    }))

  const handleEventClick = (info: EventClickArg) => {
    const { lobbyId } = info.event.extendedProps
    navigate(`/app/lobbies/${lobbyId}/meetings/${info.event.id}`)
  }

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
                        className="w-full flex items-center justify-between gap-3 rounded-lg border-2 p-3 text-left hover:bg-muted/50 transition-colors"
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
                      className="w-full flex items-center justify-between gap-3 rounded-lg border-2 p-3 text-left hover:bg-muted/50 transition-colors"
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

      {/* Right panel — FullCalendar */}
      <div className="flex-1 overflow-hidden p-4 flex flex-col max-w-3xl">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          events={calendarEvents}
          eventClick={handleEventClick}
          timeZone={userTimezone}
          height="100%"
          eventDisplay="block"
          eventClassNames="cursor-pointer"
        />
      </div>
    </div>
  )
}
