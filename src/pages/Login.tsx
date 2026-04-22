import { useState } from 'react'
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
  updateProfile,
  EmailAuthProvider,
  linkWithCredential,
  signOut,
  type User,
} from 'firebase/auth'
import { FirebaseError } from 'firebase/app'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { auth, db, googleProvider } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type AuthMode = 'signin' | 'signup'

type PasswordLinkIntent = {
  email: string
  password: string
  firstName?: string
  lastName?: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const NAME_REGEX = /^[A-Za-z][A-Za-z' -]*$/

type PasswordStrength = {
  score: number
  label: 'Very weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  checks: {
    length: boolean
    upper: boolean
    lower: boolean
    number: boolean
    symbol: boolean
  }
}

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email)
}

function isValidName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length >= 2 && trimmed.length <= 40 && NAME_REGEX.test(trimmed)
}

function isPasswordProviderUser(user: User): boolean {
  return user.providerData.some((provider) => provider.providerId === 'password')
}

function getPasswordStrength(value: string): PasswordStrength {
  const checks = {
    length: value.length >= 8,
    upper: /[A-Z]/.test(value),
    lower: /[a-z]/.test(value),
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  }

  const score = Object.values(checks).filter(Boolean).length
  const label: PasswordStrength['label'] =
    score <= 1 ? 'Very weak'
      : score === 2 ? 'Weak'
        : score === 3 ? 'Fair'
          : score === 4 ? 'Good'
            : 'Strong'

  return { score, label, checks }
}

function strengthColor(score: number): string {
  if (score <= 1) return 'bg-red-500'
  if (score === 2) return 'bg-orange-500'
  if (score === 3) return 'bg-yellow-500'
  if (score === 4) return 'bg-blue-500'
  return 'bg-green-500'
}

function getAuthActionUrl(): string {
  return `${window.location.origin}/auth/action`
}

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<AuthMode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [linkIntent, setLinkIntent] = useState<PasswordLinkIntent | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  const passwordStrength = getPasswordStrength(password)

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    if (nextMode === 'signup') {
      setFirstName('')
      setLastName('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setLinkIntent(null)
    }
  }

  const enforceVerifiedEmail = async (user: User): Promise<boolean> => {
    if (!isPasswordProviderUser(user) || user.emailVerified) return true
    let verificationSent = false
    try {
      await sendEmailVerification(user, { url: getAuthActionUrl(), handleCodeInApp: false })
      verificationSent = true
    } catch (error) {
      if (error instanceof FirebaseError) {
        console.error('sendEmailVerification failed', { code: error.code, message: error.message })
      }
    }

    await signOut(auth)
    if (verificationSent) {
      toast.error('Verify your email before signing in. We sent a verification link to your inbox. Check spam if email is not in your primary inbox.')
    } else {
      toast.error('Verify your email before signing in. We could not send a new verification link right now. Sign in later to request another link.')
    }
    return false
  }

  const handleForgotPassword = async () => {
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      toast.error('Enter your email first, then click Forgot password.')
      return
    }
    if (!isValidEmail(trimmedEmail)) {
      toast.error('Invalid email address. Use a format like name@example.com.')
      return
    }

    setSendingReset(true)
    try {
      await sendPasswordResetEmail(auth, trimmedEmail)
      toast.success('Password reset email sent. Check your inbox and spam if email is not in your primary inbox.')
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'auth/user-not-found') {
        toast.error('No account exists for this email address.')
      } else {
        toast.error('Unable to send password reset email. Please try again.')
      }
    } finally {
      setSendingReset(false)
    }
  }

  const ensureUserDoc = async (
    user: User,
    options?: { accessToken?: string; refreshToken?: string; tokenExpiresAt?: Date; firstName?: string; lastName?: string; displayName?: string }
  ) => {
    const userRef = doc(db, 'users', user.uid)
    const userSnap = await getDoc(userRef)
    const resolvedDisplayName = options?.displayName ?? user.displayName
    const resolvedFirstName = options?.firstName?.trim() || undefined
    const resolvedLastName = options?.lastName?.trim() || undefined

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName: resolvedDisplayName,
        email: user.email,
        photoURL: user.photoURL,
        createdAt: new Date(),
        onboardingComplete: false,
        firstName: resolvedFirstName,
        lastName: resolvedLastName,
      })
    }

    const payload: Record<string, unknown> = {
      'settings.timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
      photoURL: user.photoURL,
      email: user.email,
      displayName: resolvedDisplayName,
    }
    if (resolvedFirstName) payload.firstName = resolvedFirstName
    if (resolvedLastName) payload.lastName = resolvedLastName
    if (options?.accessToken) {
      payload.googleAccessToken = options.accessToken
      payload.tokenUpdatedAt = new Date()
      if (options.tokenExpiresAt) {
        payload.tokenExpiresAt = options.tokenExpiresAt
      }
    }
    if (options?.refreshToken) {
      payload.googleRefreshToken = options.refreshToken
    }
    await setDoc(userRef, payload, { merge: true })
  }

  const handleGoogleSignIn = async () => {
    setSubmitting(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const user = result.user
      const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenResponse = (result as any)._tokenResponse
      const refreshToken: string = tokenResponse?.oauthRefreshToken ?? tokenResponse?.refreshToken ?? ''
      const expiresIn = parseInt(tokenResponse?.expiresIn ?? '3600', 10)
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

      let linkedPassword = false
      if (linkIntent) {
        if (!user.email || user.email.toLowerCase() !== linkIntent.email.toLowerCase()) {
          await signOut(auth)
          toast.error(`Use the Google account for ${linkIntent.email} to link this password.`)
          return
        }

        try {
          const credential = EmailAuthProvider.credential(linkIntent.email, linkIntent.password)
          await linkWithCredential(user, credential)
          linkedPassword = true
        } catch (error) {
          if (error instanceof FirebaseError && error.code === 'auth/provider-already-linked') {
            linkedPassword = true
          } else if (
            error instanceof FirebaseError &&
            (error.code === 'auth/credential-already-in-use' || error.code === 'auth/email-already-in-use')
          ) {
            console.error('Password link conflict', {
              code: error.code,
              email: linkIntent.email,
              googleUserUid: user.uid,
              googleUserEmail: user.email,
            })
            toast.error('That email/password is already attached to a different account. Use Forgot Password or a different password.')
            return
          } else {
            if (error instanceof FirebaseError) {
              console.error('Password linking failed', {
                code: error.code,
                message: error.message,
                email: linkIntent.email,
              })
            }
            throw error
          }
        }
      }

      const displayNameFromForm =
        linkIntent?.firstName || linkIntent?.lastName
          ? `${linkIntent.firstName ?? ''} ${linkIntent.lastName ?? ''}`.trim()
          : undefined

      await ensureUserDoc(user, {
        accessToken,
        refreshToken: refreshToken || undefined,
        tokenExpiresAt,
        firstName: linkIntent?.firstName,
        lastName: linkIntent?.lastName,
        displayName: displayNameFromForm,
      })

      const verifiedOk = await enforceVerifiedEmail(user)
      if (!verifiedOk) return

      setLinkIntent(null)

      if (linkedPassword) {
        toast.success('Signed in with Google and linked email/password for future logins.')
      } else {
        toast.success('Signed in successfully!')
      }
      navigate('/app/dashboard')
    } catch (error) {
      if (error instanceof FirebaseError) {
        console.error('Google sign in error', { code: error.code, message: error.message })
      }
      toast.error('Google sign in failed. Please try again.')
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEmailAuth = async () => {
    const trimmedEmail = email.trim()
    const trimmedFirstName = firstName.trim()
    const trimmedLastName = lastName.trim()

    if (!trimmedEmail || !password) {
      toast.error('Enter your email and password.')
      return
    }

    if (!isValidEmail(trimmedEmail)) {
      toast.error('Invalid email address. Use a format like name@example.com.')
      return
    }

    if (mode === 'signup' && (!trimmedFirstName || !trimmedLastName)) {
      toast.error('Enter your first and last name.')
      return
    }

    if (mode === 'signup' && !isValidName(trimmedFirstName)) {
      toast.error('Invalid first name. Use 2-40 letters.')
      return
    }

    if (mode === 'signup' && !isValidName(trimmedLastName)) {
      toast.error('Invalid last name. Use 2-40 letters.')
      return
    }

    if (mode === 'signup' && password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const methods = await fetchSignInMethodsForEmail(auth, trimmedEmail)
      const isGoogleOnly = methods.includes('google.com') && !methods.includes('password')

      if (isGoogleOnly) {
        setLinkIntent({
          email: trimmedEmail,
          password,
          firstName: mode === 'signup' ? trimmedFirstName : undefined,
          lastName: mode === 'signup' ? trimmedLastName : undefined,
        })
        toast.info('This account uses Google. Continue with Google below and we will link this password.')
        return
      }

      if (mode === 'signup') {
        const result = await createUserWithEmailAndPassword(auth, trimmedEmail, password)
        const displayName = `${trimmedFirstName} ${trimmedLastName}`.trim()
        await updateProfile(result.user, { displayName })
        await ensureUserDoc(result.user, {
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          displayName,
        })
        await sendEmailVerification(result.user, { url: getAuthActionUrl(), handleCodeInApp: false })
        await signOut(auth)
        toast.success('Account created. Verify your email to continue then sign in. Check spam if email is not in your primary inbox.')
        setMode('signin')
        setPassword('')
        setConfirmPassword('')
        return
      } else {
        const result = await signInWithEmailAndPassword(auth, trimmedEmail, password)
        const verifiedOk = await enforceVerifiedEmail(result.user)
        if (!verifiedOk) return
        await ensureUserDoc(result.user)
        toast.success('Signed in successfully!')
      }
      navigate('/app/dashboard')
    } catch (error) {
      if (error instanceof FirebaseError) {
        console.error('Email auth error', {
          mode,
          code: error.code,
          message: error.message,
          email: trimmedEmail,
        })
      }

      if (error instanceof FirebaseError && mode === 'signin') {
        if (error.code === 'auth/invalid-email') {
          toast.error('Invalid email address. Use a format like name@example.com.')
          return
        }

        if (error.code === 'auth/wrong-password') {
          toast.error('Incorrect password. Please try again.')
          return
        }

        if (error.code === 'auth/user-not-found') {
          toast.error('No account exists for this email address.')
          return
        }

        const shouldOfferGoogleLink = [
          'auth/invalid-credential',
          'auth/invalid-login-credentials',
        ].includes(error.code)

        if (shouldOfferGoogleLink) {
          try {
            const methods = await fetchSignInMethodsForEmail(auth, trimmedEmail)
            const stillGoogleOnly = methods.includes('google.com') && !methods.includes('password')

            if (stillGoogleOnly) {
              setLinkIntent({ email: trimmedEmail, password })
              toast.info('If this account was created with Google, continue with Google below once to link this password.')
              return
            }
          } catch (methodsError) {
            console.error('Failed to inspect sign-in methods after sign-in error', methodsError)
          }

          toast.error('Incorrect email or password. Please try again.')
          return
        }
      }

      if (error instanceof FirebaseError && mode === 'signup' && error.code === 'auth/email-already-in-use') {
        setLinkIntent({
          email: trimmedEmail,
          password,
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
        })
        toast.info('This email already exists. If it is a Google account, continue with Google below to link a password.')
        return
      }

      if (error instanceof FirebaseError && mode === 'signup' && error.code === 'auth/invalid-email') {
        toast.error('Invalid email address. Use a format like name@example.com.')
        return
      }

      if (error instanceof FirebaseError && mode === 'signup' && error.code === 'auth/weak-password') {
        toast.error('Password is too weak. Use at least 6 characters.')
        return
      }

      toast.error(mode === 'signup' ? 'Sign up failed. Please try again.' : 'Sign in failed. Please try again.')
      console.error(error)
    } finally {
      setSubmitting(false)
    }
  }

  const title = mode === 'signin' ? 'Sign in to Chronos' : 'Create your Chronos account'
  const subtitle = mode === 'signin'
    ? 'Use your email and password, or continue with Google.'
    : 'Sign up with email and password, or use Google to continue.'

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md p-8 rounded-xl border bg-card shadow-sm flex flex-col gap-6">
        <Button
          type="button"
          variant="ghost"
          className="w-fit px-2"
          onClick={() => navigate('/')}
          disabled={submitting}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>

        <div className="inline-flex rounded-lg border p-1 bg-muted/20">
          <button
            type="button"
            onClick={() => switchMode('signin')}
            className={`flex-1 h-8 rounded-md text-sm font-medium transition-colors ${
              mode === 'signin'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`flex-1 h-8 rounded-md text-sm font-medium transition-colors ${
              mode === 'signup'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            Sign up
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {mode === 'signup' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-first-name">First name</Label>
                <Input
                  id="login-first-name"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-last-name">Last name</Label>
                <Input
                  id="login-last-name"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'signin' && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={sendingReset || submitting}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {sendingReset ? 'Sending reset...' : 'Forgot password?'}
                </button>
              </div>
            )}
            {mode === 'signup' && password.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: 5 }, (_, index) => (
                    <span
                      key={index}
                      className={`h-1.5 flex-1 rounded-full ${index < passwordStrength.score ? strengthColor(passwordStrength.score) : 'bg-muted'}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Password strength: {passwordStrength.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  Use at least 8 characters with uppercase, lowercase, numbers and symbols for strongest security.
                </p>
              </div>
            )}
          </div>
          {mode === 'signup' && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-confirm-password">Confirm password</Label>
              <Input
                id="login-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}
          <Button className="w-full mt-1" onClick={handleEmailAuth} disabled={submitting}>
            {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign in with Email' : 'Create Account'}
          </Button>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-px bg-border flex-1" />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Or</span>
          <div className="h-px bg-border flex-1" />
        </div>
        <Button
          className="w-full border border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
          onClick={handleGoogleSignIn}
          disabled={submitting}
        >
          <span className="inline-flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                fill="#4285F4"
                d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.31h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.14 3.57-8.65Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.87-3c-1.07.72-2.44 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.27v3.09A12 12 0 0 0 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.3A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.37-2.3V6.61H1.27A12 12 0 0 0 0 12c0 1.93.46 3.75 1.27 5.39l4-3.09Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.77c1.76 0 3.33.61 4.57 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4 3.09C6.22 6.88 8.87 4.77 12 4.77Z"
              />
            </svg>
            {submitting ? 'Please wait...' : 'Continue with Google'}
          </span>
        </Button>
      </div>
    </div>
  )
}
