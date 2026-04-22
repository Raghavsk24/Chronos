import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  collection, query, where, getDocs, updateDoc,
  doc, arrayRemove, writeBatch,
} from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { Trash2, LogOut, Search, ArrowUpDown } from 'lucide-react'
import Avatar from '@/components/Avatar'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import CreateLobbyModal from '@/components/CreateLobbyModal'
import { meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'
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

interface MeetingCounts {
  scheduling: number
  scheduled: number
  completed: number
  declined: number
}

type ConfirmAction = { type: 'delete' | 'leave'; lobby: Lobby }

function formatDate(createdAt?: { seconds: number } | null): string {
  if (!createdAt) return ''
  return new Date(createdAt.seconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

interface StatCardProps {
  label: string
  count: number
  colorClass?: string
}

function StatCard({ label, count, colorClass }: StatCardProps) {
  return (
    <div className={`flex-1 rounded-lg border px-4 py-3 flex items-center gap-3 ${colorClass ?? ''}`}>
      <span className="text-2xl font-bold tabular-nums">{count}</span>
      <span className="text-sm font-medium leading-tight">{label}</span>
    </div>
  )
}

export default function Lobbies() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [meetingCountsByLobby, setMeetingCountsByLobby] = useState<Record<string, MeetingCounts>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortAsc, setSortAsc] = useState(false)
  const [acting, setActing] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const fetchAll = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [lobbiesSnap, meetingsSnap] = await Promise.all([
        getDocs(query(collection(db, 'lobbies'), where('memberUids', 'array-contains', user.uid))),
        getDocs(query(collection(db, 'meetings'), where('memberUids', 'array-contains', user.uid))),
      ])

      const lobbiesData = lobbiesSnap.docs.map((d) => ({ id: d.id, ...d.data() } as Lobby))

      const counts: Record<string, MeetingCounts> = {}
      meetingsSnap.docs.forEach((d) => {
        const { lobbyId, status } = d.data() as { lobbyId: string; status: MeetingStatus }
        if (!counts[lobbyId]) counts[lobbyId] = { scheduling: 0, scheduled: 0, completed: 0, declined: 0 }
        if (status in counts[lobbyId]) counts[lobbyId][status as keyof MeetingCounts]++
      })

      setLobbies(lobbiesData)
      setMeetingCountsByLobby(counts)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { fetchAll() }, [fetchAll])

  const totalCounts = useMemo(() => {
    const totals = { scheduling: 0, scheduled: 0, completed: 0 }
    Object.values(meetingCountsByLobby).forEach((c) => {
      totals.scheduling += c.scheduling
      totals.scheduled += c.scheduled
      totals.completed += c.completed
    })
    return totals
  }, [meetingCountsByLobby])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? lobbies.filter(
          (l) => l.name.toLowerCase().includes(q) || (l.description ?? '').toLowerCase().includes(q)
        )
      : [...lobbies]
    list.sort((a, b) => {
      const diff = (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0)
      return sortAsc ? diff : -diff
    })
    return list
  }, [lobbies, search, sortAsc])

  const handleDelete = async (lobby: Lobby) => {
    setActing(true)
    try {
      const meetingsSnap = await getDocs(
        query(collection(db, 'meetings'), where('lobbyId', '==', lobby.id))
      )
      const batch = writeBatch(db)
      meetingsSnap.docs.forEach((d) => batch.delete(d.ref))
      batch.delete(doc(db, 'lobbies', lobby.id))
      await batch.commit()
      setLobbies((prev) => prev.filter((l) => l.id !== lobby.id))
      toast.success('Lobby deleted.')
    } catch {
      toast.error('Failed to delete lobby.')
    } finally {
      setActing(false)
      setConfirm(null)
    }
  }

  const handleLeave = async (lobby: Lobby) => {
    if (!user) return
    setActing(true)
    try {
      const me = lobby.members.find((m) => m.uid === user.uid)
      await updateDoc(doc(db, 'lobbies', lobby.id), {
        memberUids: arrayRemove(user.uid),
        members: arrayRemove(me),
      })
      setLobbies((prev) => prev.filter((l) => l.id !== lobby.id))
      toast.success('You left the lobby.')
    } catch {
      toast.error('Failed to leave lobby.')
    } finally {
      setActing(false)
      setConfirm(null)
    }
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
      <div className="px-8 py-8">

        {/* Title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Lobbies</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Your groups and their meetings.</p>
        </div>

        {/* Stats row */}
        <div className="flex gap-3 mb-6">
          <StatCard label={lobbies.length === 1 ? 'Lobby' : 'Lobbies'} count={lobbies.length} />
          <StatCard
            label={`Meeting${totalCounts.scheduling !== 1 ? 's' : ''} Scheduling`}
            count={totalCounts.scheduling}
            colorClass="bg-yellow-50 border-yellow-200"
          />
          <StatCard
            label={`Meeting${totalCounts.scheduled !== 1 ? 's' : ''} Scheduled`}
            count={totalCounts.scheduled}
            colorClass="bg-blue-50 border-blue-200"
          />
          <StatCard
            label={`Meeting${totalCounts.completed !== 1 ? 's' : ''} Completed`}
            count={totalCounts.completed}
            colorClass="bg-green-50 border-green-200"
          />
        </div>

        {/* Search + sort + create */}
        <div className="flex items-center gap-2 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortAsc((v) => !v)}
            className="gap-1.5 shrink-0"
          >
            <ArrowUpDown className="size-3.5" />
            {sortAsc ? 'Oldest first' : 'Newest first'}
          </Button>
          <div className="shrink-0">
            <CreateLobbyModal onCreated={fetchAll} />
          </div>
        </div>

        {/* Cards */}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading lobbies...</p>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-base font-medium">
              {search ? 'No lobbies match your search.' : 'No lobbies yet.'}
            </p>
            {!search && <p className="text-sm mt-1">Create one to get started.</p>}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((lobby) => {
              const isHost = user?.uid === lobby.hostUid
              const counts = meetingCountsByLobby[lobby.id] ?? { scheduling: 0, scheduled: 0, completed: 0 }
              const totalMeetings = counts.scheduling + counts.scheduled + counts.completed
              const hostMember = lobby.members.find((m) => m.uid === lobby.hostUid)

              return (
                <div
                  key={lobby.id}
                  onClick={() => navigate(`/app/lobbies/${lobby.id}`)}
                  className="border rounded-xl px-5 pt-5 pb-0 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  {/* Name + description */}
                  <h2 className="text-xl font-bold tracking-tight leading-snug">{lobby.name}</h2>
                  {lobby.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{lobby.description}</p>
                  )}

                  {/* Status pills */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(['scheduling', 'scheduled', 'completed'] as MeetingStatus[]).map((status) => {
                      const { label, className } = meetingStatusConfig(status)
                      return (
                        <span key={status} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}>
                          {counts[status]} {label}
                        </span>
                      )
                    })}
                    {totalMeetings === 0 && (
                      <span className="text-xs text-muted-foreground">No meetings yet</span>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-5 pt-[7px] pb-[7px] border-t">
                    {/* Host info + meta */}
                    <div className="flex items-center gap-2">
                      <Avatar src={hostMember?.photoURL} name={lobby.hostName} className="w-5 h-5 text-[10px]" />
                      <p className="text-xs text-muted-foreground">
                        {lobby.hostName}
                        {lobby.createdAt && <> · {formatDate(lobby.createdAt)}</>}
                        <> · {lobby.memberUids.length} member{lobby.memberUids.length !== 1 ? 's' : ''}</>
                      </p>
                    </div>

                    {/* Delete / Leave icon */}
                    {isHost ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirm({ type: 'delete', lobby }) }}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      >
                        <Trash2 className="size-4" strokeWidth={2.5} />
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirm({ type: 'leave', lobby }) }}
                        className="text-muted-foreground hover:text-foreground transition-colors p-1"
                      >
                        <LogOut className="size-4" strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      <Dialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === 'delete' ? 'Delete lobby?' : 'Leave lobby?'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm?.type === 'delete'
              ? `This will permanently delete "${confirm.lobby.name}" and all its meetings. This cannot be undone.`
              : `You will be removed from "${confirm?.lobby.name}" and lose access to its meetings.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={acting}>Cancel</Button>
            <Button
              variant={confirm?.type === 'delete' ? 'destructive' : 'outline'}
              disabled={acting}
              onClick={() => {
                if (!confirm) return
                confirm.type === 'delete' ? handleDelete(confirm.lobby) : handleLeave(confirm.lobby)
              }}
            >
              {acting
                ? confirm?.type === 'delete' ? 'Deleting...' : 'Leaving...'
                : confirm?.type === 'delete' ? 'Delete lobby' : 'Leave lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
