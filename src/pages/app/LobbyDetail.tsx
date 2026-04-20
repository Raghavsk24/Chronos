import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, getDocs, updateDoc,
  arrayRemove, collection, query, where, writeBatch,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { ChevronRight, Pencil, Trash2, LogOut, X, Search, ArrowUpDown, Link2, Copy, ArrowLeft } from 'lucide-react'
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
  status: MeetingStatus
  scheduledSlot?: { start: string; end: string }
  createdAt?: { seconds: number }
}

function formatDate(createdAt?: { seconds: number } | null): string {
  if (!createdAt) return '—'
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

  // Lobby rename
  const [renaming, setRenaming] = useState(false)
  const [nameEdit, setNameEdit] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Delete / leave
  const [showDelete, setShowDelete] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [acting, setActing] = useState(false)

  // Member removal
  const [removingUid, setRemovingUid] = useState<string | null>(null)

  // Meetings filtering
  const [meetingSearch, setMeetingSearch] = useState('')
  const [meetingSortAsc, setMeetingSortAsc] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MeetingStatus | 'all'>('all')

  const fetchAll = useCallback(async () => {
    if (!id || !user) return
    const [lobbySnap, userSnap, meetingsSnap] = await Promise.all([
      getDoc(doc(db, 'lobbies', id)),
      getDoc(doc(db, 'users', user.uid)),
      getDocs(query(collection(db, 'meetings'), where('lobbyId', '==', id))),
    ])
    if (!lobbySnap.exists()) { navigate('/app/lobbies'); return }
    setLobby({ id: lobbySnap.id, ...lobbySnap.data() } as Lobby)
    setMeetings(meetingsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting)))
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

  const handleRenameSave = async () => {
    if (!nameEdit.trim() || !lobby) return
    setSavingName(true)
    try {
      await updateDoc(doc(db, 'lobbies', lobby.id), { name: nameEdit.trim() })
      setLobby({ ...lobby, name: nameEdit.trim() })
      setRenaming(false)
      toast.success('Lobby renamed.')
    } catch {
      toast.error('Failed to rename lobby.')
    } finally {
      setSavingName(false)
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

  if (loading) return (
    <div className="p-8">
      <p className="text-sm text-muted-foreground">Loading lobby...</p>
    </div>
  )
  if (!lobby) return null

  const isHost = user?.uid === lobby.hostUid

  return (
    <div className="flex flex-col min-h-full">

      {/* Sticky top nav */}
      <div className="sticky top-0 z-10 bg-background border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/app/lobbies')}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </button>
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSave()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="h-8 text-base font-bold max-w-xs"
                autoFocus
              />
              <Button size="sm" onClick={handleRenameSave} disabled={!nameEdit.trim() || savingName}>
                {savingName ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl font-bold text-foreground truncate">{lobby.name}</span>
              {isHost && (
                <button
                  onClick={() => { setNameEdit(lobby.name); setRenaming(true) }}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
        {isHost ? (
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)} className="shrink-0">
            <Trash2 className="size-3.5 mr-1.5" />
            Delete Lobby
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowLeave(true)} className="shrink-0">
            <LogOut className="size-3.5 mr-1.5" />
            Leave Lobby
          </Button>
        )}
      </div>

      {/* Lobby Overview — full width */}
      <div className="px-8 py-6 border-b">
        <h2 className="text-[16.5px] font-bold underline underline-offset-2 mb-2">Lobby Overview</h2>
        {lobby.description && (
          <p className="text-sm text-muted-foreground mb-3">
            <span className="font-bold text-foreground">Description: </span>
            {lobby.description}
          </p>
        )}

        {/* Metadata pills */}
        <div className="flex flex-wrap gap-1.5 mb-[21px]">
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

        {/* Invitation Link inline */}
        {isHost && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-start gap-3">
              <span className="text-sm font-bold whitespace-nowrap mt-[5px]">Invitation Link:</span>
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
          </div>
        )}
      </div>

      {/* 70/30 columns — no per-column scroll */}
      <div className="flex flex-1">

        {/* LEFT 70% — Meetings */}
        <div className="flex-[7] border-r px-8 py-6">
          <h2 className="text-[16.5px] font-bold underline underline-offset-2 mb-4">Meetings</h2>

          {/* Search + sort + New Meeting in one row */}
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
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
            {isHost && <div className="shrink-0"><CreateMeetingModal onCreated={fetchAll} defaultLobbyId={id} /></div>}
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
            <p className="text-sm text-muted-foreground">
              {meetings.length === 0 ? 'No meetings yet.' : 'No meetings match your filter.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredMeetings.map((m) => {
                const { label, className } = meetingStatusConfig(m.status)
                return (
                  <button
                    key={m.id}
                    onClick={() => navigate(`/app/lobbies/${id}/meetings/${m.id}`)}
                    className="w-full text-left border rounded-xl p-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-snug truncate">{m.name}</p>
                        {m.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{m.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {m.duration} min
                          {m.scheduledSlot && (
                            <> · {slotDate(m.scheduledSlot.start, userTimezone)} {slotTime(m.scheduledSlot.start, userTimezone)}</>
                          )}
                          {m.createdAt && <> · {formatMeetingDate(m.createdAt)}</>}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
                          {label}
                        </span>
                        <ChevronRight className="size-4 text-muted-foreground" />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* RIGHT 30% — Participants */}
        <div className="flex-[3] px-6 py-6">
          <h2 className="text-[16.5px] font-bold underline underline-offset-2 mb-4">
            Participants
          </h2>
          <ul className="flex flex-col divide-y -mt-[10px]">
            {lobby.members.map((member) => {
              const isThisHost = member.uid === lobby.hostUid
              const isMe = member.uid === user?.uid
              return (
                <li key={member.uid} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={member.photoURL} name={member.displayName} className="w-8 h-8 text-xs" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight truncate">
                        {member.displayName}
                        {isMe && <span className="text-muted-foreground font-normal text-xs"> (you)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
        </div>
      </div>

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
            <Button variant="outline" onClick={handleLeave} disabled={acting}>
              {acting ? 'Leaving...' : 'Leave lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
