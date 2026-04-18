import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth'
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { auth, db, googleProvider } from '@/lib/firebase'
import { Button } from '@/components/ui/button'

export default function Login() {
  const navigate = useNavigate()

  const handleGoogleSignIn = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user
      const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? ''

      const userRef = doc(db, 'users', user.uid)
      const userSnap = await getDoc(userRef)

      if (!userSnap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName,
          email: user.email,
          photoURL: user.photoURL,
          createdAt: new Date(),
        })
      }

      await updateDoc(userRef, {
        googleAccessToken: accessToken,
        tokenUpdatedAt: new Date(),
        'settings.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      })

      toast.success('Signed in successfully!')
      navigate('/app/dashboard')
    } catch (error) {
      toast.error('Sign in failed. Please try again.')
      console.error(error)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm p-8 rounded-xl border bg-card shadow-sm flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Chronos</h1>
          <p className="text-muted-foreground text-sm mt-1">Sign in to continue</p>
        </div>
        <Button className="w-full" onClick={handleGoogleSignIn}>
          Continue with Google
        </Button>
      </div>
    </div>
  )
}
