import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, getDocs, updateDoc, deleteDoc,
  arrayRemove, collection, query, where, writeBatch,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { ChevronRight, Settings, Trash2, LogOut, X, Search, ArrowUpDown, Link2, Copy, ArrowLeft } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import CreateMeetingModal from '@/components/CreateMeetingModal'
import { slotDate, slotTime, meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Member {
  uid: string
  displayName: string
  email: string
  photoURL: string
}

interface Lobby {
  id: string
  name: string
  description?: string
  hostUid: string
  hostName: string
  members: Member[]
  memberUids: string[]
  createdAt?: { seconds: number } | null
}

interface Meeting {
  id: string
  name: string
  description?: string
  duration: number
  meetingLink?: string
  status: MeetingStatus
  scheduledSlot?: { start: string; end: string }
  memberUids?: string[]
  members?: Member[]
  createdAt?: { seconds: number }
}

type FirestoreTimestampLike =
  | { seconds: number }
  | { toDate: () => Date }
  | Date
  | string
  | number
  | null
  | undefined

const GOOGLE_TOKEN_STALE_MINUTES = 55

function isGoogleTokenFresh(tokenUpdatedAt: FirestoreTimestampLike): boolean {
  if (!tokenUpdatedAt) return false

  let tokenDate: Date | null = null
  if (tokenUpdatedAt instanceof Date) tokenDate = tokenUpdatedAt
  else if (typeof tokenUpdatedAt === 'string' || typeof tokenUpdatedAt === 'number') tokenDate = new Date(tokenUpdatedAt)
  else if (typeof (tokenUpdatedAt as { toDate?: () => Date }).toDate === 'function') {
    tokenDate = (tokenUpdatedAt as { toDate: () => Date }).toDate()
  } else if (typeof (tokenUpdatedAt as { seconds?: number }).seconds === 'number') {
    tokenDate = new Date((tokenUpdatedAt as { seconds: number }).seconds * 1000)
  }

  if (!tokenDate || Number.isNaN(tokenDate.getTime())) return false
  const ageMs = Date.now() - tokenDate.getTime()
  return ageMs <= GOOGLE_TOKEN_STALE_MINUTES * 60 * 1000
}

function formatDate(createdAt?: { seconds: number } | null): string {
  if (!createdAt) return '-'
  return new Date(createdAt.seconds * 1000).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatMeetingDate(createdAt?: { seconds: number } | null): string {
  if (!createdAt) return ''
  return new Date(createdAt.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

const STATUS_FILTERS: { value: MeetingStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduling', label: 'Scheduling' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
]

export default function LobbyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)

  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [userTimezone, setUserTimezone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  // Lobby settings
  const [showLobbySettings, setShowLobbySettings] = useState(false)
  const [savingLobbySettings, setSavingLobbySettings] = useState(false)
  const [lobbyForm, setLobbyForm] = useState({ name: '', description: '' })

  // Delete / leave
  const [showDelete, setShowDelete] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [acting, setActing] = useState(false)

  // Member removal
  const [removingUid, setRemovingUid] = useState<string | null>(null)

  // Meeting row action
  const [showMeetingRowAction, setShowMeetingRowAction] = useState(false)
  const [meetingRowTarget, setMeetingRowTarget] = useState<Meeting | null>(null)
  const [meetingRowActing, setMeetingRowActing] = useState(false)

  // Meetings filtering
  const [meetingSearch, setMeetingSearch] = useState('')
  const [meetingSortAsc, setMeetingSortAsc] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'all'>('all')
  const [calendarConnectionByUid, setCalendarConnectionByUid] = useState<Record<string, boolean>>({})

  const fetchAll = useCallback(async () => {
    if (!id || !user) return
    const [lobbySnap, userSnap, meetingsSnap] = await Promise.all([
      getDoc(doc(db, 'lobbies', id)),
      getDoc(doc(db, 'users', user.uid)),
      getDocs(query(collection(db, 'meetings'), where('lobbyId', '==', id))),
    ])
    if (!lobbySnap.exists()) { navigate('/app/lobbies'); return }
    const lobbyData = { id: lobbySnap.id, ...lobbySnap.data() } as Lobby
    setLobby(lobbyData)
    setMeetings(meetingsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting)))

    const statusEntries = await Promise.all(
      (lobbyData.memberUids ?? []).map(async (uid) => {
        const memberSnap = await getDoc(doc(db, 'users', uid))
        if (!memberSnap.exists()) return [uid, false] as const
        const memberData = memberSnap.data() as Record<string, unknown>
        const connected = Boolean(memberData.googleAccessToken) && isGoogleTokenFresh(memberData.tokenUpdatedAt as FirestoreTimestampLike)
        return [uid, connected] as const
      })
    )
    setCalendarConnectionByUid(Object.fromEntries(statusEntries))

    const tz = userSnap.data()?.settings?.timezone
    if (tz) setUserTimezone(tz)
    setLoading(false)
  }, [id, user])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filteredMeetings = useMemo(() => {
    const q = meetingSearch.trim().toLowerCase()
    const list = meetings.filter((m) => {
      const matchesSearch = !q || m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q)
      const matchesStatus = statusFilter === 'all' || m.status === statusFilter
      return matchesSearch && matchesStatus
    })
    return [...list].sort((a, b) => {
      const diff = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
      return meetingSortAsc ? diff : -diff
    })
  }, [meetings, meetingSearch, statusFilter, meetingSortAsc])

  const openLobbySettings = () => {
    if (!lobby) return
    setLobbyForm({
      name: lobby.name,
      description: lobby.description ?? '',
    })
    setShowLobbySettings(true)
  }

  const handleSaveLobbySettings = async () => {
    if (!lobby || !lobbyForm.name.trim()) return
    setSavingLobbySettings(true)
    try {
      const payload = {
        name: lobbyForm.name.trim(),
        description: lobbyForm.description.trim() || null,
      }
      await updateDoc(doc(db, 'lobbies', lobby.id), payload)
      setLobby({
        ...lobby,
        name: payload.name,
        description: payload.description ?? undefined,
      })
      toast.success('Lobby settings updated.')
      setShowLobbySettings(false)
    } catch {
      toast.error('Failed to update lobby settings.')
    } finally {
      setSavingLobbySettings(false)
    }
  }

  const handleDelete = async () => {
    if (!lobby) return
    setActing(true)
    try {
      const meetingsSnap = await getDocs(
        query(collection(db, 'meetings'), where('lobbyId', '==', lobby.id))
      )
      const batch = writeBatch(db)
      meetingsSnap.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(doc(db, 'lobbies', lobby.id))
      await batch.commit()
      toast.success('Lobby deleted.')
      navigate('/app/lobbies')
    } catch {
      toast.error('Failed to delete lobby.')
      setActing(false)
    }
  }

  const handleLeave = async () => {
    if (!lobby || !user) return
    setActing(true)
    try {
      const me = lobby.members.find((m) => m.uid === user.uid)
      await updateDoc(doc(db, 'lobbies', lobby.id), {
        memberUids: arrayRemove(user.uid),
        members: arrayRemove(me),
      })
      toast.success('You left the lobby.')
      navigate('/app/lobbies')
    } catch {
      toast.error('Failed to leave lobby.')
      setActing(false)
    }
  }

  const handleRemoveMember = async (member: Member) => {
    if (!lobby) return
    setRemovingUid(member.uid)
    try {
      await updateDoc(doc(db, 'lobbies', lobby.id), {
        memberUids: arrayRemove(member.uid),
        members: arrayRemove(member),
      })
      setLobby({
        ...lobby,
        members: lobby.members.filter((m) => m.uid !== member.uid),
        memberUids: lobby.memberUids.filter((u) => u !== member.uid),
      })
      setCalendarConnectionByUid((prev) => {
        const next = { ...prev }
        delete next[member.uid]
        return next
      })
      toast.success(`${member.displayName} removed.`)
    } catch {
      toast.error('Failed to remove member.')
    } finally {
      setRemovingUid(null)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${lobby?.id}`)
    toast.success('Invite link copied!')
  }

  const openMeetingRowAction = (meeting: Meeting) => {
    setMeetingRowTarget(meeting)
    setShowMeetingRowAction(true)
  }

  const handleConfirmMeetingRowAction = async () => {
    if (!meetingRowTarget || !user) return
    setMeetingRowActing(true)
    try {
      if (isHost) {
        await deleteDoc(doc(db, 'meetings', meetingRowTarget.id))
        setMeetings((prev) => prev.filter((m) => m.id !== meetingRowTarget.id))
        toast.success('Meeting deleted.')
      } else {
        const me = meetingRowTarget.members?.find((m) => m.uid === user.uid)
        const updates: Record<string, unknown> = { memberUids: arrayRemove(user.uid) }
        if (me) updates.members = arrayRemove(me)
        await updateDoc(doc(db, 'meetings', meetingRowTarget.id), updates)
        setMeetings((prev) => prev.filter((m) => m.id !== meetingRowTarget.id))
        toast.success('You left the meeting.')
      }
      setShowMeetingRowAction(false)
      setMeetingRowTarget(null)
    } catch {
      toast.error(isHost ? 'Failed to delete meeting.' : 'Failed to leave meeting.')
    } finally {
      setMeetingRowActing(false)
    }
  }

  if (loading) return (
    <div className="p-6 md:p-8 space-y-4">
      <div className="h-8 w-72 rounded-md bg-muted animate-pulse" />
      <div className="h-32 rounded-xl border bg-muted/30 animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
        <div className="h-72 rounded-xl border bg-muted/30 animate-pulse" />
      </div>
    </div>
  )
  if (!lobby) return null

  const isHost = user?.uid === lobby.hostUid

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto">

      {/* Sticky top nav */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/app/lobbies')}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
            <span className="text-sm font-medium">All Lobbies</span>
          </button>
        </div>
        {isHost ? (
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)} className="shrink-0">
            <Trash2 className="size-3.5 mr-1.5" />
            Delete Lobby
          </Button>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setShowLeave(true)} className="shrink-0">
            <LogOut className="size-3.5 mr-1.5" />
            Leave Lobby
          </Button>
        )}
      </div>

      <div className="px-6 md:px-8 py-6 space-y-4">
        {/* Lobby Overview */}
        <section className="rounded-2xl border bg-card px-6 py-5">
          <div className="flex items-center gap-2 mb-2 min-w-0">
            <h2 className="text-[22.5px] font-bold underline underline-offset-2 truncate">{lobby.name}</h2>
            {isHost && (
              <button
                onClick={openLobbySettings}
                className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="Open lobby settings"
                title="Lobby settings"
              >
                <Settings className="size-4" />
              </button>
            )}
          </div>
          {lobby.description && (
            <p className="text-sm text-muted-foreground mb-3">{lobby.description}</p>
          )}

          <div className="flex flex-wrap gap-1.5 mb-[25px]">
            {[
              { label: 'Date Created', value: formatDate(lobby.createdAt) },
              { label: 'Host', value: lobby.hostName },
              { label: 'Meetings', value: String(meetings.length) },
              { label: 'Members', value: String(lobby.memberUids.length) },
            ].map(({ label, value }) => (
              <span key={label} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs">
                <span className="font-semibold text-black">{label}:</span>
                <span className="text-black">{value}</span>
              </span>
            ))}
          </div>

          {isHost && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1 flex-1 max-w-lg min-w-0">
                <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 min-w-0">
                  <Link2 className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground truncate flex-1">
                    {window.location.origin}/join/{lobby.id}
                  </span>
                  <button
                    onClick={handleCopyLink}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy link"
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <p className="text-[8px] text-muted-foreground">
                  Share this invite link with your team so they can join the lobby.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* Main columns */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">

        {/* LEFT Meetings */}
        <section className="rounded-2xl border bg-card px-6 md:px-8 py-6">
          <h2 className="text-lg font-semibold tracking-tight mb-4">Meetings</h2>

          {/* Search + sort + New Meeting in one row */}
          <div className="flex flex-wrap gap-2 mb-3">
            <div className="relative min-w-[240px] flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search meetings..."
                value={meetingSearch}
                onChange={(e) => setMeetingSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMeetingSortAsc((v) => !v)}
              className="gap-1 shrink-0 h-8 text-xs px-2.5"
            >
              <ArrowUpDown className="size-3" />
              {meetingSortAsc ? 'Oldest' : 'Newest'}
            </Button>
            {isHost && <div className="shrink-0 ml-auto"><CreateMeetingModal onCreated={fetchAll} defaultLobbyId={id} /></div>}
          </div>

          {/* Status filter pills */}
          <div className="flex gap-1.5 flex-wrap mb-4">
            {STATUS_FILTERS.map(({ value, label }) => {
              const active = statusFilter === value
              const cfg = value !== 'all' ? meetingStatusConfig(value) : null
              return (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                    active
                      ? cfg ? cfg.className : 'bg-foreground text-background border-foreground'
                      : 'bg-background text-muted-foreground border-input hover:bg-accent'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>

          {/* Meeting cards */}
          {filteredMeetings.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-sm font-medium">
                {meetings.length === 0 ? 'No meetings yet' : 'No meetings match your filters'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {meetings.length === 0
                  ? (isHost ? 'Create a meeting to start scheduling with your team.' : 'The host can create a meeting to get started.')
                  : 'Try changing your search text or status filter.'}
              </p>
              {isHost && meetings.length === 0 && (
                <div className="mt-3 flex justify-center">
                  <CreateMeetingModal onCreated={fetchAll} defaultLobbyId={id} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredMeetings.map((m) => {
                const { label, className } = meetingStatusConfig(m.status)
                return (
                  <div
                    key={m.id}
                    onClick={() => navigate(`/app/lobbies/${id}/meetings/${m.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') navigate(`/app/lobbies/${id}/meetings/${m.id}`)
                    }}
                    role="button"
                    tabIndex={0}
                    className="w-full text-left border rounded-xl px-3 pt-3 pb-2 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3 pb-[15px]">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-snug truncate">{m.name}</p>
                        {m.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 mb-0.5 leading-relaxed break-words line-clamp-2">{m.description}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
                          {label}
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="border-t" />
                    <div className="mt-[5px] flex items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">
                        {m.duration} min
                        {m.scheduledSlot && (
                          <> · {slotDate(m.scheduledSlot.start, userTimezone)} {slotTime(m.scheduledSlot.start, userTimezone)}</>
                        )}
                        {m.createdAt && <> · {formatMeetingDate(m.createdAt)}</>}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openMeetingRowAction(m)
                        }}
                        className="inline-flex items-center justify-center h-4 w-4 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={isHost ? 'Delete meeting' : 'Leave meeting'}
                        title={isHost ? 'Delete meeting' : 'Leave meeting'}
                      >
                        {isHost ? <Trash2 className="size-3.5" /> : <LogOut className="size-3.5" />}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* RIGHT Participants */}
        <section className="rounded-2xl border bg-card px-6 py-6">
          <h2 className="text-lg font-semibold tracking-tight mb-4">
            Participants
          </h2>
          {lobby.members.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center">
              <p className="text-sm font-medium">No participants yet</p>
              <p className="text-xs text-muted-foreground mt-1">Share the invite link to bring teammates into this lobby.</p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y -mt-[12px]">
            {lobby.members.map((member) => {
              const isThisHost = member.uid === lobby.hostUid
              const isMe = member.uid === user?.uid
              return (
                <li key={member.uid} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Avatar src={member.photoURL} name={member.displayName} className="w-8 h-8 text-xs" />
                    <div className="min-w-0 max-w-full">
                      <p className="text-sm font-medium leading-tight truncate max-w-full">
                        {member.displayName}
                        {isMe && <span className="text-muted-foreground font-normal text-xs"> (you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[11px] border rounded-full px-2 py-0.5 ${
                        calendarConnectionByUid[member.uid]
                          ? 'text-green-700 border-green-200 bg-green-50'
                          : 'text-amber-700 border-amber-200 bg-amber-50'
                      }`}
                    >
                      {calendarConnectionByUid[member.uid] ? 'Calendar connected' : 'Calendar not connected'}
                    </span>
                    {isThisHost && (
                      <span className="text-xs text-muted-foreground border rounded-full px-2 py-0.5">
                        Host
                      </span>
                    )}
                    {isHost && !isThisHost && (
                      <button
                        onClick={() => handleRemoveMember(member)}
                        disabled={removingUid === member.uid}
                        className="w-6 h-6 rounded-full border border-input flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive transition-colors disabled:opacity-40"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
            </ul>
          )}
        </section>
      </div>
      </div>

      <Dialog open={showLobbySettings} onOpenChange={setShowLobbySettings}>
        <DialogContent className="sm:max-w-2xl w-[95vw] max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Lobby Settings</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Lobby name</label>
              <Input
                value={lobbyForm.name}
                onChange={(e) => setLobbyForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Lobby name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Description</label>
              <textarea
                rows={3}
                value={lobbyForm.description}
                onChange={(e) => setLobbyForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="What is this group for?"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLobbySettings(false)} disabled={savingLobbySettings}>Cancel</Button>
            <Button onClick={handleSaveLobbySettings} disabled={!lobbyForm.name.trim() || savingLobbySettings}>
              {savingLobbySettings ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMeetingRowAction} onOpenChange={setShowMeetingRowAction}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isHost ? 'Delete meeting?' : 'Leave meeting?'}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {isHost
              ? `This will permanently delete ${meetingRowTarget?.name ?? 'this meeting'}.`
              : `You will be removed from ${meetingRowTarget?.name ?? 'this meeting'}.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMeetingRowAction(false)} disabled={meetingRowActing}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmMeetingRowAction} disabled={meetingRowActing}>
              {meetingRowActing
                ? (isHost ? 'Deleting...' : 'Leaving...')
                : (isHost ? 'Delete meeting' : 'Leave meeting')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete lobby?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{lobby.name}</strong> and all its meetings. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={acting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={acting}>
              {acting ? 'Deleting...' : 'Delete lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirmation */}
      <Dialog open={showLeave} onOpenChange={setShowLeave}>
        <DialogContent>
          <DialogHeader><DialogTitle>Leave lobby?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            You will be removed from <strong>{lobby.name}</strong> and lose access to its meetings.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeave(false)} disabled={acting}>Cancel</Button>
            <Button variant="destructive" onClick={handleLeave} disabled={acting}>
              {acting ? 'Leaving...' : 'Leave lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
