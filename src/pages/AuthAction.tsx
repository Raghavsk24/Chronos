import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { applyActionCode, checkActionCode } from 'firebase/auth'
import { auth } from '@/lib/firebase'
import { buttonVariants } from '@/components/ui/button'

type ActionState = {
  loading: boolean
  title: string
  message: string
  success: boolean
}

const INITIAL_STATE: ActionState = {
  loading: true,
  title: 'Checking your verification link',
  message: 'Please wait while we verify your email link.',
  success: false,
}

export default function AuthAction() {
  const [state, setState] = useState<ActionState>(INITIAL_STATE)

  useEffect(() => {
    let mounted = true

    const run = async () => {
      const search = new URLSearchParams(window.location.search)
      const mode = search.get('mode')
      const oobCode = search.get('oobCode')

      if (mode !== 'verifyEmail') {
        if (!mounted) return
        setState({
          loading: false,
          title: 'Unsupported auth action',
          message: 'This link type is not currently supported in Chronos. Please continue from the login page.',
          success: false,
        })
        return
      }

      if (!oobCode) {
        if (!mounted) return
        setState({
          loading: false,
          title: 'Invalid verification link',
          message: 'The verification link is missing required details. Request a new verification email.',
          success: false,
        })
        return
      }

      try {
        await checkActionCode(auth, oobCode)
        await applyActionCode(auth, oobCode)

        if (!mounted) return
        setState({
          loading: false,
          title: 'Email verified',
          message: 'Your email has been verified. You can now sign in to Chronos.',
          success: true,
        })
      } catch {
        if (!mounted) return
        setState({
          loading: false,
          title: 'Verification link expired or invalid',
          message: 'This verification link is no longer valid. Sign in and request a new verification email.',
          success: false,
        })
      }
    }

    run()

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card shadow-sm p-7 flex flex-col gap-4">
        <h1 className="text-2xl font-bold tracking-tight">{state.title}</h1>
        <p className="text-sm text-muted-foreground">{state.message}</p>

        {state.loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="pt-1 flex items-center gap-2">
            <Link to="/login" className={buttonVariants()}>Go to Login</Link>
            {!state.success && (
              <Link to="/" className={buttonVariants({ variant: 'outline' })}>Back to Home</Link>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
