import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { arrayRemove, deleteDoc, doc, getDoc, updateDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink, CheckCircle2, Trash2, LogOut, RotateCcw } from 'lucide-react'
import { db, functions } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
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
          <h1 className="text-3xl font-bold tracking-tight min-w-0 break-words">{meeting.name}</h1>
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
