import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
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
  const [profileOpen, setProfileOpen] = useState(false)

  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-14 border-b flex items-center justify-between px-6 shrink-0">
        <span className="text-lg font-bold tracking-tight">Chronos</span>
        <button
          onClick={() => setProfileOpen(true)}
          className="group flex items-center gap-2.5 pl-1 pr-3 py-1 rounded-full hover:bg-accent transition-colors"
        >
          <Avatar src={user?.photoURL} name={user?.displayName} className="w-7 h-7 text-xs" />
          <span className="text-sm font-medium leading-none group-hover:underline truncate max-w-[180px]">{user?.displayName}</span>
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-48 border-r flex flex-col p-4 gap-1 shrink-0">
          {navItems.map(({ to, label }) => (
            <NavLink key={to} to={to} className={navClass}>
              {label}
            </NavLink>
          ))}
          <NavLink to="/app/settings" className={navClass} style={{ marginTop: 'auto' }}>
            Settings
          </NavLink>
        </aside>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <UserProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  )
}
