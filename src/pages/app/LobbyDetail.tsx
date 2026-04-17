import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
}

export default function LobbyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)

  useEffect(() => {
    const fetchLobby = async () => {
      if (!id) return
      const snap = await getDoc(doc(db, 'lobbies', id))
      if (!snap.exists()) {
        navigate('/app/lobbies')
        return
      }
      setLobby({ id: snap.id, ...snap.data() } as Lobby)
      setLoading(false)
    }
    fetchLobby()
  }, [id])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !lobby || !user) return
    setInviting(true)

    try {
      const lobbyRef = doc(db, 'lobbies', lobby.id)
      await updateDoc(lobbyRef, {
        invites: arrayUnion(inviteEmail.trim().toLowerCase()),
      })
      toast.success(`Invite sent to ${inviteEmail}`)
      setInviteEmail('')
    } catch (error) {
      toast.error('Failed to send invite.')
      console.error(error)
    } finally {
      setInviting(false)
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

      <div className="border rounded-xl p-5 mb-6">
        <h2 className="font-semibold mb-4">Members ({lobby.members.length})</h2>
        <ul className="flex flex-col gap-3">
          {lobby.members.map((member) => (
            <li key={member.uid} className="flex items-center gap-3">
              {member.photoURL && (
                <img
                  src={member.photoURL}
                  alt={member.displayName}
                  className="w-8 h-8 rounded-full"
                />
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

      {isHost && (
        <div className="border rounded-xl p-5">
          <h2 className="font-semibold mb-4">Invite a member</h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email address</Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
              <Button onClick={handleInvite} disabled={!inviteEmail.trim() || inviting}>
                {inviting ? 'Sending...' : 'Invite'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
