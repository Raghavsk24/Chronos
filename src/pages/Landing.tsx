import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-8 py-4 border-b">
        <h1 className="text-2xl font-bold tracking-tight">Chronos</h1>
        <div className="flex gap-3">
          <Link to="/login" className={cn(buttonVariants({ variant: 'ghost' }))}>
            Log in
          </Link>
          <Link to="/login" className={cn(buttonVariants({ variant: 'default' }))}>
            Sign up
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-6">
        <h2 className="text-5xl font-bold tracking-tight max-w-2xl">
          Schedule meetings for your group automatically.
        </h2>
        <p className="text-muted-foreground text-lg max-w-xl">
          Chronos connects to your team's Google Calendars and finds the perfect time for everyone. No back-and-forth. No conflicts.
        </p>
        <Link to="/login" className={cn(buttonVariants({ size: 'lg' }))}>
          Get started for free
        </Link>
      </main>

      <footer className="text-center text-sm text-muted-foreground py-6 border-t">
        © {new Date().getFullYear()} Chronos
      </footer>
    </div>
  )
}
