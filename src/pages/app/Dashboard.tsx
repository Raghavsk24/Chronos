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
import { Badge } from '@/components/ui/badge'
import CreateLobbyModal from '@/components/CreateLobbyModal'
import CreateMeetingModal from '@/components/CreateMeetingModal'
import { slotDate, slotTime } from '@/lib/timeUtils'

interface Meeting {
  id: string
  lobbyId: string
  lobbyName: string
  name: string
  duration: number
  status: 'open' | 'scheduled'
  scheduledSlot?: { start: string; end: string }
}

interface Lobby {
  id: string
  name: string
  memberUids: string[]
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

  const upcomingMeetings = meetings
    .filter((m) => m.status === 'scheduled' && m.scheduledSlot)
    .sort((a, b) => {
      const aTime = new Date(a.scheduledSlot!.start.endsWith('Z') ? a.scheduledSlot!.start : a.scheduledSlot!.start + 'Z').getTime()
      const bTime = new Date(b.scheduledSlot!.start.endsWith('Z') ? b.scheduledSlot!.start : b.scheduledSlot!.start + 'Z').getTime()
      return aTime - bTime
    })

  const calendarEvents = meetings
    .filter((m) => m.status === 'scheduled' && m.scheduledSlot)
    .map((m) => ({
      id: m.id,
      title: m.name,
      start: m.scheduledSlot!.start.endsWith('Z') ? m.scheduledSlot!.start : m.scheduledSlot!.start + 'Z',
      end: m.scheduledSlot!.end.endsWith('Z') ? m.scheduledSlot!.end : m.scheduledSlot!.end + 'Z',
      extendedProps: { lobbyId: m.lobbyId },
    }))

  const handleEventClick = (info: EventClickArg) => {
    const { lobbyId } = info.event.extendedProps
    navigate(`/app/lobbies/${lobbyId}/meetings/${info.event.id}`)
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left panel */}
      <div className="w-[38%] border-r flex flex-col overflow-hidden shrink-0">
        {/* Action buttons */}
        <div className="p-6 pb-4 flex gap-2 border-b shrink-0">
          <CreateLobbyModal onCreated={fetchData} />
          <CreateMeetingModal onCreated={fetchData} />
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
          {/* Upcoming Meetings */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Upcoming Meetings
            </h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : upcomingMeetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scheduled meetings yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {upcomingMeetings.map((m) => (
                  <li key={m.id}>
                    <button
                      onClick={() => navigate(`/app/lobbies/${m.lobbyId}/meetings/${m.id}`)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {slotDate(m.scheduledSlot!.start, userTimezone)}{' '}
                          {slotTime(m.scheduledSlot!.start, userTimezone)}
                        </p>
                        <p className="text-xs text-muted-foreground">{m.lobbyName}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">Scheduled</Badge>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="border-t" />

          {/* All Lobbies */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              All Lobbies
            </h2>
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : lobbies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lobbies yet. Create one above.</p>
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
