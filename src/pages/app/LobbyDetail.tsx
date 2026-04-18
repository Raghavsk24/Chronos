import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { db, functions } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { slotDate, slotTime, tzAbbr } from '@/lib/timeUtils'

interface Member {
  uid: string
  displayName: string
  email: string
  photoURL: string
}

interface Lobby {
  id: string
  name: string
  hostUid: string
  hostName: string
  members: Member[]
  memberUids: string[]
  meetingDuration: number
  status: string
  scheduledSlot?: { start: string; end: string }
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

export default function LobbyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [finding, setFinding] = useState(false)
  const [slots, setSlots] = useState<Slot[]>([])
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const [scheduleError, setScheduleError] = useState('')
  const [booking, setBooking] = useState(false)
  const [bookingError, setBookingError] = useState('')
  const [userTimezone, setUserTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  useEffect(() => {
    const fetchLobby = async () => {
      if (!id || !user) return
      const [lobbySnap, userSnap] = await Promise.all([
        getDoc(doc(db, 'lobbies', id)),
        getDoc(doc(db, 'users', user.uid)),
      ])
      if (!lobbySnap.exists()) {
        navigate('/app/lobbies')
        return
      }
      setLobby({ id: lobbySnap.id, ...lobbySnap.data() } as Lobby)
      const tz = userSnap.data()?.settings?.timezone
      if (tz) setUserTimezone(tz)
      setLoading(false)
    }
    fetchLobby()
  }, [id])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !lobby || !user) return
    setInviting(true)
    try {
      await updateDoc(doc(db, 'lobbies', lobby.id), {
        invites: arrayUnion(inviteEmail.trim().toLowerCase()),
      })
      toast.success(`${inviteEmail} added to invite list`)
      setInviteEmail('')
    } catch (error) {
      toast.error('Failed to add invite.')
      console.error(error)
    } finally {
      setInviting(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${lobby?.id}`)
    toast.success('Invite link copied to clipboard!')
  }

  const handleFindSlots = async () => {
    if (!lobby) return
    setFinding(true)
    setSlots([])
    setSelectedSlot(null)
    setScheduleError('')
    try {
      const result = await scheduleMeeting({ lobbyId: lobby.id })
      const data = result.data as { slots?: Slot[]; error?: string }
      if (data.error) {
        setScheduleError(data.error)
      } else {
        setSlots(data.slots ?? [])
        if (!data.slots?.length) {
          setScheduleError('No available slots found in the next 4 weeks.')
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to find meeting times.'
      setScheduleError(message)
    } finally {
      setFinding(false)
    }
  }

  const handleBook = async () => {
    if (!lobby || !selectedSlot) return
    setBooking(true)
    setBookingError('')
    try {
      await bookMeeting({ lobbyId: lobby.id, slotStart: selectedSlot.start, slotEnd: selectedSlot.end })
      setLobby({ ...lobby, status: 'scheduled', scheduledSlot: { start: selectedSlot.start, end: selectedSlot.end } })
      setSlots([])
      setSelectedSlot(null)
      toast.success('Meeting booked! Calendar invites sent to all members.')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to book meeting.'
      setBookingError(message)
    } finally {
      setBooking(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading lobby...</p>
      </div>
    )
  }

  if (!lobby) return null

  const isHost = user?.uid === lobby.hostUid

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => navigate('/app/lobbies')}
        className="text-sm text-muted-foreground hover:text-foreground mb-6 block"
      >
        ← Back to Lobbies
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{lobby.name}</h1>
          <p className="text-muted-foreground mt-1">
            Hosted by {lobby.hostName} · {lobby.meetingDuration} min meeting
          </p>
        </div>
        <span className="text-sm capitalize border rounded-full px-3 py-1">{lobby.status}</span>
      </div>

      {/* Members */}
      <div className="border rounded-xl p-5 mb-6">
        <h2 className="font-semibold mb-4">Members ({lobby.members.length})</h2>
        <ul className="flex flex-col gap-3">
          {lobby.members.map((member) => (
            <li key={member.uid} className="flex items-center gap-3">
              {member.photoURL && (
                <img src={member.photoURL} alt={member.displayName} className="w-8 h-8 rounded-full" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {member.displayName}
                  {member.uid === lobby.hostUid && (
                    <span className="ml-2 text-xs text-muted-foreground">(host)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{member.email}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Scheduling — host only */}
      {isHost && (
        <div className="border rounded-xl p-5 mb-6 flex flex-col gap-4">
          {lobby.status === 'scheduled' && lobby.scheduledSlot ? (
            <div>
              <h2 className="font-semibold mb-1">Meeting scheduled</h2>
              <p className="text-sm text-muted-foreground">
                {slotDate(lobby.scheduledSlot.start, userTimezone)} ·{' '}
                {slotTime(lobby.scheduledSlot.start, userTimezone)} –{' '}
                {slotTime(lobby.scheduledSlot.end, userTimezone)}{' '}
                ({tzAbbr(lobby.scheduledSlot.start, userTimezone)})
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Calendar invites were sent to all members.
              </p>
            </div>
          ) : (
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

              {scheduleError && (
                <p className="text-sm text-destructive">{scheduleError}</p>
              )}

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
                        <p className="text-muted-foreground text-sm">
                          {slotTime(slot.start, userTimezone)} – {slotTime(slot.end, userTimezone)}{' '}
                          ({tzAbbr(slot.start, userTimezone)})
                        </p>
                      </button>
                    )
                  })}

                  {selectedSlot && (
                    <>
                      {bookingError && (
                        <p className="text-sm text-destructive">{bookingError}</p>
                      )}
                      <Button className="mt-2 w-full" onClick={handleBook} disabled={booking}>
                        {booking
                          ? 'Booking...'
                          : `Confirm ${slotDate(selectedSlot.start, userTimezone)} ${slotTime(selectedSlot.start, userTimezone)}`}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Invite controls — host only */}
      {isHost && (
        <div className="border rounded-xl p-5 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold mb-1">Invite link</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Share this link with anyone you want to invite.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={`${window.location.origin}/join/${lobby.id}`}
                className="text-muted-foreground"
              />
              <Button onClick={handleCopyLink}>Copy</Button>
            </div>
          </div>

          <div>
            <h2 className="font-semibold mb-1">Restrict by email</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Optionally add specific emails — only those addresses will be allowed to join.
            </p>
            <Label htmlFor="invite-email">Email address</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
              <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
                {inviting ? 'Adding...' : 'Add'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
