import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/app/dashboard', label: 'Dashboard' },
  { to: '/app/lobbies', label: 'Lobbies' },
  { to: '/app/calendar', label: 'Calendar' },
]

export default function AppLayout() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-56 border-r flex flex-col p-4 gap-1">
        <span className="text-xl font-bold tracking-tight px-3 py-2 mb-4">Chronos</span>
        {navItems.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
