import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { ChevronDown, LogOut } from 'lucide-react'
import { auth, db, googleProvider } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import UserProfilePanel from '@/components/UserProfilePanel'
import Avatar from '@/components/Avatar'
import { Link } from 'react-router-dom'
import ChronosLogo from '@/components/ChronosLogo'
import { Button } from '@/components/ui/button'

const navItems = [
  { to: '/app/dashboard', label: 'Dashboard' },
  { to: '/app/lobbies', label: 'Lobbies' },
]

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  }`

export default function AppLayout() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const [calendarExpired, setCalendarExpired] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  useEffect(() => {
    if (!user?.uid) return
    let cancelled = false

    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (cancelled || !snap.exists()) return
      const data = snap.data()
      const hasRefreshToken = Boolean(data.googleRefreshToken)
      if (!hasRefreshToken) return // never connected calendar — no banner needed

      const tokenExpiresAt = data.tokenExpiresAt
      if (!tokenExpiresAt) return // no expiry recorded — assume valid

      const expiresMs: number =
        typeof tokenExpiresAt.toDate === 'function'
          ? tokenExpiresAt.toDate().getTime()
          : tokenExpiresAt instanceof Date
            ? tokenExpiresAt.getTime()
            : typeof tokenExpiresAt.seconds === 'number'
              ? tokenExpiresAt.seconds * 1000
              : 0

      if (expiresMs > 0 && expiresMs < Date.now()) {
        setCalendarExpired(true)
      }
    })

    return () => { cancelled = true }
  }, [user?.uid])

  const handleReconnect = async () => {
    if (!user) return
    setReconnecting(true)
    try {
      const result = await signInWithPopup(auth, googleProvider)
      const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenResponse = (result as any)._tokenResponse
      const refreshToken: string = tokenResponse?.oauthRefreshToken ?? tokenResponse?.refreshToken ?? ''
      const expiresIn = parseInt(tokenResponse?.expiresIn ?? '3600', 10)
      const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000)

      if (!accessToken) return

      await setDoc(doc(db, 'users', user.uid), {
        googleAccessToken: accessToken,
        tokenExpiresAt,
        tokenUpdatedAt: new Date(),
        ...(refreshToken ? { googleRefreshToken: refreshToken } : {}),
      }, { merge: true })

      setCalendarExpired(false)
    } catch {
      // silently fail — user can try again from Settings
    } finally {
      setReconnecting(false)
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="border-b-[1.5px] shrink-0">
        <div className="h-14 flex items-center justify-between px-4 md:px-6">
          <Link to="/app/dashboard">
            <ChronosLogo height={30} />
          </Link>
          <button
            onClick={() => setProfileOpen(true)}
            className="group flex items-center gap-2 pl-1 pr-2 py-1 rounded-full border-[1.5px] border-slate-300 bg-slate-100 hover:bg-slate-200/70 transition-colors"
          >
            <Avatar src={user?.photoURL} name={user?.displayName} className="w-7 h-7 text-xs" />
            <span className="text-[15.5px] font-medium leading-[1.15] text-left group-hover:underline whitespace-normal break-words max-w-[160px] md:max-w-[220px]">
              {user?.displayName}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>

        <nav className="md:hidden border-t-[1.5px] px-3 py-2 flex items-center gap-1 overflow-x-auto">
          {navItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>
              {label}
            </NavLink>
          ))}
          <NavLink to="/app/settings" className={navClass}>Settings</NavLink>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-destructive hover:bg-destructive/10 hover:text-destructive text-left whitespace-nowrap"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </nav>

        {calendarExpired && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 flex items-center justify-between gap-4">
            <p className="text-xs text-amber-800">
              Your Google Calendar connection has expired. Reconnect so the scheduling algorithm can read your availability.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 border-amber-300 text-amber-900 hover:bg-amber-100"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              {reconnecting ? 'Reconnecting...' : 'Reconnect Calendar'}
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden md:flex w-48 border-r-[1.5px] flex-col p-4 gap-1 shrink-0">
          {navItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>
              {label}
            </NavLink>
          ))}

          <div className="mt-auto flex flex-col gap-1">
            <div className="border-t-[1.5px] my-1" />
            <NavLink to="/app/settings" className={navClass}>
              Settings
            </NavLink>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-destructive hover:bg-destructive/10 hover:text-destructive text-left"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-hidden min-w-0">
          <Outlet />
        </main>
      </div>

      <UserProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
