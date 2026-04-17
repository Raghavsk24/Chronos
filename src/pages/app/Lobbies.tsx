import { useEffect, useState } from 'react'
import { collection, query, where, getDocs } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import CreateLobbyModal from '@/components/CreateLobbyModal'

interface Lobby {
  id: string
  name: string
  hostName: string
  memberUids: string[]
  meetingDuration: number
  status: string
}

export default function Lobbies() {
  const user = useAuthStore((state) => state.user)
  const [lobbies, setLobbies] = useState<Lobby[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  const fetchLobbies = async () => {
    if (!user) return
    setLoading(true)

    const q = query(
      collection(db, 'lobbies'),
      where('memberUids', 'array-contains', user.uid)
    )
    const snapshot = await getDocs(q)
    const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Lobby))
    setLobbies(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchLobbies()
  }, [user])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Lobbies</h1>
          <p className="text-muted-foreground mt-1">Create a lobby and invite your group.</p>
        </div>
        <CreateLobbyModal onCreated={fetchLobbies} />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading lobbies...</p>
      ) : lobbies.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No lobbies yet.</p>
          <p className="text-sm mt-1">Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lobbies.map((lobby) => (
            <div
              key={lobby.id}
              onClick={() => navigate(`/app/lobbies/${lobby.id}`)}
              className="border rounded-xl p-5 cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <h2 className="font-semibold text-lg">{lobby.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">Host: {lobby.hostName}</p>
              <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                <span>{lobby.memberUids.length} member{lobby.memberUids.length !== 1 ? 's' : ''}</span>
                <span>{lobby.meetingDuration} min</span>
                <span className="capitalize">{lobby.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
