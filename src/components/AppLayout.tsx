import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { auth } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import UserProfilePanel from '@/components/UserProfilePanel'
import Avatar from '@/components/Avatar'

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

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="border-b shrink-0">
        <div className="h-14 flex items-center justify-between px-4 md:px-6">
          <span className="text-lg font-bold tracking-tight">Chronos</span>
          <button
            onClick={() => setProfileOpen(true)}
            className="group flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full hover:bg-accent transition-colors"
          >
            <Avatar src={user?.photoURL} name={user?.displayName} className="w-7 h-7 text-xs" />
            <span className="text-sm font-medium leading-none group-hover:underline truncate max-w-[140px] md:max-w-[180px]">
              {user?.displayName}
            </span>
          </button>
        </div>

        <nav className="md:hidden border-t px-3 py-2 flex items-center gap-1 overflow-x-auto">
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
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden md:flex w-48 border-r flex-col p-4 gap-1 shrink-0">
          {navItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>
              {label}
            </NavLink>
          ))}

          <div className="mt-auto flex flex-col gap-1">
            <div className="border-t my-1" />
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
