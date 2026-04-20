import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [onboardingDone, setOnboardingDone] = useState(false)
  const setUser = useAuthStore((state) => state.setUser)
  const setOnboardingComplete = useAuthStore((state) => state.setOnboardingComplete)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        await user.reload()
        const refreshed = auth.currentUser ?? user
        setUser(refreshed)
        setIsAuthenticated(true)

        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        updateDoc(doc(db, 'users', refreshed.uid), {
          'settings.timezone': browserTz,
          photoURL: refreshed.photoURL,
        }).catch(() => {})

        const snap = await getDoc(doc(db, 'users', refreshed.uid))
        const complete = snap.exists() && snap.data().onboardingComplete === true
        setOnboardingDone(complete)
        setOnboardingComplete(complete)
      } else {
        setUser(null)
        setIsAuthenticated(false)
        setOnboardingDone(false)
        setOnboardingComplete(false)
      }
      setLoading(false)
    })

    return unsubscribe
  }, [setUser, setOnboardingComplete])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!onboardingDone) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}
