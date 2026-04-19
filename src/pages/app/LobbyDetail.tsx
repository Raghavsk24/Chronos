import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, getDocs, updateDoc,
  arrayUnion, arrayRemove, collection, query, where, writeBatch,
} from 'firebase/firestore'
import { toast } from 'sonner'
import { ChevronRight, Pencil, Trash2, LogOut, X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
}

interface Meeting {
  id: string
  name: string
  duration: number
  status: MeetingStatus
  scheduledSlot?: { start: string; end: string }
}

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

  // Rename
  const [renaming, setRenaming] = useState(false)
  const [nameEdit, setNameEdit] = useState('')
  const [savingName, setSavingName] = useState(false)

  // Delete / leave dialogs
  const [showDelete, setShowDelete] = useState(false)
  const [showLeave, setShowLeave] = useState(false)
  const [acting, setActing] = useState(false)

  // Member removal
  const [removingUid, setRemovingUid] = useState<string | null>(null)

  // Invite
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!id || !user) return
    const [lobbySnap, userSnap, meetingsSnap] = await Promise.all([
      getDoc(doc(db, 'lobbies', id)),
      getDoc(doc(db, 'users', user.uid)),
      getDocs(query(collection(db, 'meetings'), where('lobbyId', '==', id))),
    ])
    if (!lobbySnap.exists()) { navigate('/app/dashboard'); return }
    setLobby({ id: lobbySnap.id, ...lobbySnap.data() } as Lobby)
    setMeetings(
      meetingsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Meeting))
        .sort((a, b) => (b.status === 'scheduled' ? 1 : 0) - (a.status === 'scheduled' ? 1 : 0))
    )
    const tz = userSnap.data()?.settings?.timezone
    if (tz) setUserTimezone(tz)
    setLoading(false)
  }, [id, user])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleRenameStart = () => {
    setNameEdit(lobby!.name)
    setRenaming(true)
  }

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
      navigate('/app/dashboard')
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
      toast.success('You have left the lobby.')
      navigate('/app/dashboard')
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
      setLobby({ ...lobby, members: lobby.members.filter((m) => m.uid !== member.uid), memberUids: lobby.memberUids.filter((u) => u !== member.uid) })
      toast.success(`${member.displayName} removed.`)
    } catch {
      toast.error('Failed to remove member.')
    } finally {
      setRemovingUid(null)
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !lobby) return
    setInviting(true)
    try {
      await updateDoc(doc(db, 'lobbies', lobby.id), {
        invites: arrayUnion(inviteEmail.trim().toLowerCase()),
      })
      toast.success(`${inviteEmail} added to invite list.`)
      setInviteEmail('')
    } catch {
      toast.error('Failed to add invite.')
    } finally {
      setInviting(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/join/${lobby?.id}`)
    toast.success('Invite link copied!')
  }

  if (loading) return <div className="p-8"><p className="text-muted-foreground">Loading lobby...</p></div>
  if (!lobby) return null

  const isHost = user?.uid === lobby.hostUid

  return (
    <div className="p-8 max-w-2xl">
      <button
        onClick={() => navigate('/app/dashboard')}
        className="text-sm text-muted-foreground hover:text-foreground mb-6 block"
      >
        ← Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <Input
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameSave()}
                className="text-2xl font-bold h-auto py-1"
                autoFocus
              />
              <Button size="sm" onClick={handleRenameSave} disabled={!nameEdit.trim() || savingName}>
                {savingName ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{lobby.name}</h1>
              {isHost && (
                <button onClick={handleRenameStart} className="text-muted-foreground hover:text-foreground mt-1">
                  <Pencil className="size-4" />
                </button>
              )}
            </div>
          )}
          <p className="text-muted-foreground mt-1 text-sm">Hosted by {lobby.hostName}</p>
          {lobby.description && <p className="text-sm mt-1">{lobby.description}</p>}
        </div>
        <div className="flex gap-2 ml-4 shrink-0">
          {isHost ? (
            <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowLeave(true)}>
              <LogOut className="size-4" />
              Leave
            </Button>
          )}
        </div>
      </div>

      {/* Members */}
      <div className="border-2 rounded-xl p-5 mb-6">
        <h2 className="font-semibold mb-4">Members ({lobby.members.length})</h2>
        <ul className="flex flex-col gap-3">
          {lobby.members.map((member) => (
            <li key={member.uid} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
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
              </div>
              {isHost && member.uid !== lobby.hostUid && (
                <button
                  onClick={() => handleRemoveMember(member)}
                  disabled={removingUid === member.uid}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  <X className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* Meetings */}
      <div className="border-2 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Meetings ({meetings.length})</h2>
          {isHost && (
            <CreateMeetingModal onCreated={fetchAll} defaultLobbyId={id} />
          )}
        </div>
        {meetings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No meetings yet. Create one to get started.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {meetings.map((m) => {
              const { label, className } = meetingStatusConfig(m.status)
              return (
                <li key={m.id}>
                  <button
                    onClick={() => navigate(`/app/lobbies/${id}/meetings/${m.id}`)}
                    className="w-full flex items-center justify-between gap-3 rounded-lg border-2 p-3 text-left hover:bg-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{m.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.duration} min
                        {m.scheduledSlot && (
                          <> · {slotDate(m.scheduledSlot.start, userTimezone)} {slotTime(m.scheduledSlot.start, userTimezone)}</>
                        )}
                      </p>
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

      {/* Invite — host only */}
      {isHost && (
        <div className="border-2 rounded-xl p-5 flex flex-col gap-5">
          <div>
            <h2 className="font-semibold mb-1">Invite link</h2>
            <p className="text-sm text-muted-foreground mb-3">
              Share this link with anyone you want to invite.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={`${window.location.origin}/join/${lobby.id}`} className="text-muted-foreground" />
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

      {/* Delete confirmation */}
      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete lobby?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{lobby.name}</strong> and cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={acting}>
              {acting ? 'Deleting...' : 'Delete lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirmation */}
      <Dialog open={showLeave} onOpenChange={setShowLeave}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave lobby?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You will be removed from <strong>{lobby.name}</strong> and lose access to its meetings.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={handleLeave} disabled={acting}>
              {acting ? 'Leaving...' : 'Leave lobby'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
