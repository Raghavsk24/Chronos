import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { slotDate, slotTime, tzAbbr } from '@/lib/timeUtils'

interface Meeting {
  id: string
  lobbyId: string
  lobbyName: string
  name: string
  description?: string
  duration: number
  meetingLink?: string
  status: 'open' | 'scheduled'
  scheduledSlot?: { start: string; end: string }
  hostUid: string
  hostName: string
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
      const result = await scheduleMeeting({ lobbyId: meeting.lobbyId })
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
        lobbyId: meeting.lobbyId,
        slotStart: selectedSlot.start,
        slotEnd: selectedSlot.end,
      })
      await updateDoc(doc(db, 'meetings', meeting.id), {
        status: 'scheduled',
        scheduledSlot: { start: selectedSlot.start, end: selectedSlot.end },
        scheduledAt: new Date(),
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

  if (loading) return <div className="p-8"><p className="text-muted-foreground">Loading meeting...</p></div>
  if (!meeting) return null

  const isHost = user?.uid === meeting.hostUid

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => navigate(`/app/lobbies/${lobbyId}`)}
        className="text-sm text-muted-foreground hover:text-foreground mb-6 block"
      >
        ← Back to {meeting.lobbyName}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{meeting.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {meeting.lobbyName} · {meeting.duration} min · Hosted by {meeting.hostName}
          </p>
          {meeting.description && (
            <p className="text-sm mt-2">{meeting.description}</p>
          )}
          {meeting.meetingLink && (
            <a
              href={meeting.meetingLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-2"
            >
              <ExternalLink className="size-3.5" />
              Meeting link
            </a>
          )}
        </div>
        <Badge variant={meeting.status === 'scheduled' ? 'default' : 'outline'} className="mt-1 shrink-0 capitalize">
          {meeting.status}
        </Badge>
      </div>

      {/* Scheduling */}
      <div className="border rounded-xl p-5 flex flex-col gap-4">
        {meeting.status === 'scheduled' && meeting.scheduledSlot ? (
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
        ) : isHost ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Find a meeting time</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Searches everyone's Google Calendar for the next 4 weeks.
                </p>
              </div>
              <Button onClick={handleFindSlots} disabled={finding || booking}>
                {finding ? 'Searching...' : 'Find Meeting Times'}
              </Button>
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
  )
}
