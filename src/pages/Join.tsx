import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, setDoc, arrayUnion } from 'firebase/firestore'
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { toast } from 'sonner'
import { auth, db, googleProvider } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { type User } from 'firebase/auth'

interface Lobby {
  id: string
  name: string
  hostName: string
  memberUids: string[]
  invites: string[]
}

export default function Join() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [lobby, setLobby] = useState<Lobby | null>(null)
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const fetchLobby = async () => {
      if (!id) return
      const snap = await getDoc(doc(db, 'lobbies', id))
      if (!snap.exists()) {
        toast.error('This invite link is invalid or has expired.')
        navigate('/')
        return
      }
      setLobby({ id: snap.id, ...snap.data() } as Lobby)
      setLoading(false)
    }
    fetchLobby()
  }, [id])

  const joinLobby = async (user: User) => {
    if (!lobby) return
    setJoining(true)

    const email = user.email?.toLowerCase() ?? ''
    const hasInviteList = lobby.invites?.length > 0
    const isInvited = lobby.invites?.includes(email)
    const alreadyMember = lobby.memberUids.includes(user.uid)

    if (alreadyMember) {
      toast.success('You are already in this lobby!')
      navigate(`/app/lobbies/${lobby.id}`)
      return
    }

    // If host added specific emails, only allow those
    if (hasInviteList && !isInvited) {
      toast.error('Your email is not on the invite list for this lobby.')
      setJoining(false)
      return
    }

    try {
      const lobbyRef = doc(db, 'lobbies', lobby.id)
      await updateDoc(lobbyRef, {
        memberUids: arrayUnion(user.uid),
        members: arrayUnion({
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
        }),
      })

      toast.success(`You've joined ${lobby.name}!`)
      navigate(`/app/lobbies/${lobby.id}`)
    } catch (error) {
      toast.error('Failed to join lobby.')
      console.error(error)
    } finally {
      setJoining(false)
    }
  }

  const handleJoin = async () => {
    // Check if already signed in
    const currentUser = auth.currentUser
    if (currentUser) {
      await joinLobby(currentUser)
      return
    }

    // Otherwise sign in first then join
    try {
      const result = await signInWithPopup(auth, googleProvider)

      // Save new user to Firestore if first time
      const userRef = doc(db, 'users', result.user.uid)
      const userSnap = await getDoc(userRef)
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: result.user.uid,
          displayName: result.user.displayName,
          email: result.user.email,
          photoURL: result.user.photoURL,
          createdAt: new Date(),
        })
      }

      const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? ''
      await updateDoc(userRef, {
        googleAccessToken: accessToken,
        tokenUpdatedAt: new Date(),
        'settings.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      })

      await joinLobby(result.user)
    } catch (error) {
      toast.error('Sign in failed. Please try again.')
      console.error(error)
    }
  }

  // If already signed in, trigger join automatically
  useEffect(() => {
    if (loading) return
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user && lobby && !joining) {
        joinLobby(user)
      }
    })
    return unsubscribe
  }, [loading, lobby])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading invite...</p>
      </div>
    )
  }

  if (!lobby) return null

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm p-8 rounded-xl border-2 bg-card shadow-sm flex flex-col gap-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground mb-1">You've been invited to join</p>
          <h1 className="text-2xl font-bold tracking-tight">{lobby.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">Hosted by {lobby.hostName}</p>
        </div>
        <Button className="w-full" onClick={handleJoin} disabled={joining}>
          {joining ? 'Joining...' : 'Sign in with Google to join'}
        </Button>
      </div>
    </div>
  )
}
