import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ChronosLogo from '@/components/ChronosLogo'

const navItems = [
  { label: 'Home', href: '/' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Testimonials', href: '/#reviews' },
]

export default function MarketingNav() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className="sticky top-5 z-40 bg-transparent">
      <div
        className={cn(
          'relative mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-[9px] transition-all duration-300 sm:px-8',
          isScrolled &&
            'w-[calc(100%-140px)] max-w-[1180px] rounded-full border border-border bg-white/95 px-[78px] py-[19px] shadow-[0_6px_14px_rgba(0,0,0,0.18)] backdrop-blur-sm'
        )}
      >
        <Link to="/" aria-label="Chronos home" className="shrink-0">
          <ChronosLogo height={26} className="opacity-95" />
        </Link>

        <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 md:block">
          <nav
            className={cn(
              'pointer-events-auto flex h-[56px] items-center gap-8 transition-all duration-300',
              isScrolled
                ? 'h-[50px] bg-transparent px-0'
                : 'bg-transparent px-[6px]'
            )}
          >
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="px-1 py-1 text-sm font-normal text-muted-foreground transition-all hover:font-semibold hover:text-primary hover:underline hover:underline-offset-4"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'lg' }),
              'h-8 rounded-md border border-primary bg-white px-3 text-xs font-semibold text-primary hover:bg-muted'
            )}
          >
            Login
          </Link>
          <Link
            to="/login"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'h-8 rounded-md border border-primary bg-primary px-3 text-xs font-bold text-primary-foreground hover:bg-primary/90'
            )}
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  )
}
