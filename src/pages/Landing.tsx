import { useMemo, useState } from 'react'
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ArrowRight, ChevronLeft, ChevronRight, CircleCheck, Clock, MousePointer2, Star, UsersRound, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import MarketingFooter from '@/components/marketing/MarketingFooter'
import MarketingNav from '@/components/marketing/MarketingNav'
import { buttonVariants } from '@/components/ui/button'
import { meetingStatusConfig, type MeetingStatus } from '@/lib/timeUtils'
import { cn } from '@/lib/utils'

const testimonials = [
  {
    initial: 'S',
    name: 'Sarah Johnson',
    role: 'Working Parent',
    quote: 'Chronos transformed how our family spends time together. We actually have quality time now.',
  },
  {
    initial: 'M',
    name: 'Mu Joe',
    role: 'Founder',
    quote: 'The "synchronized lobbies" idea for automating group meeting scheduling is truly clever. Coordinating everyone\'s availability for team calls is always a pain, so this sounds like a massive time-saver.',
  },
  {
    initial: 'E',
    name: 'Evanlease',
    role: 'Student',
    quote: 'Chronos is a service I would 100% recommend to anyone managing a team. It offers something unique, and I am excited to use it in future workspaces and groups.',
  },
  {
    initial: 'L',
    name: 'Lisa Rodriguez',
    role: 'Community Organizer',
    quote: 'Coordinating everyone\'s availability for group sessions used to take days. Now it takes minutes.',
  },
  {
    initial: 'S',
    name: 'Sofia Kareem',
    role: 'Operations Manager',
    quote: 'Chronos removed the back-and-forth. We pick a time once, and everyone is instantly aligned.',
  },
  {
    initial: 'P',
    name: 'Prithvi Damera',
    role: 'AI Developer',
    quote: 'Coordinating multiple busy calendars is always a headache, so full Google Calendar sync is a big plus. Love that Chronos is built for both personal and professional groups.',
  },
]


const heroBookings: Array<{ name: string; duration: string; lobby: string; status: MeetingStatus }> = [
  { name: 'Weekly Engineering Sync', duration: '45 min', lobby: 'Team Sync Meeting', status: 'scheduled' },
  { name: 'Sprint Planning', duration: '1hr', lobby: 'Team Sync Meeting', status: 'scheduling' },
]

const topSlots = [
  { day: 'Mon Apr 21', time: '2:00 PM', score: 96 },
  { day: 'Tue Apr 22', time: '10:30 AM', score: 88 },
  { day: 'Wed Apr 23', time: '3:00 PM', score: 75 },
]

export default function Landing() {
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => startOfMonth(new Date()))
  const currentDay = new Date()

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth)
    const monthEnd = endOfMonth(calendarMonth)
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    const days: Date[] = []
    for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
      days.push(day)
    }
    return days
  }, [calendarMonth])

  const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

  return (
    <div className="min-h-screen overflow-x-clip bg-[#f8f8f8] [background-image:radial-gradient(rgba(0,0,0,0.06)_1px,transparent_1px)] [background-size:18px_18px]">
      <MarketingNav />

      <main className="mx-auto w-full max-w-[1440px] overflow-x-clip px-4 pb-8 pt-[44px] sm:px-8 sm:pt-[60px]">
        <section className="relative mx-auto max-w-[1360px] overflow-visible rounded-[2rem] border border-border bg-card px-5 py-4 shadow-sm sm:px-8 sm:py-6 lg:px-10 lg:py-7">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(circle,rgba(71,85,105,0.2)_1px,transparent_1px)] [background-size:24px_24px]"
          />

          <div className="relative grid gap-5 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
            <div className="relative -left-[10px]">
              <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                <Zap className="size-3.5" /> Introducing Chronos
              </p>

              <h1 className="mt-3 max-w-[700px] text-3xl font-black leading-[0.98] tracking-tight text-foreground sm:text-5xl lg:text-[3.35rem]">
                The better way to schedule your{' '}
                <span className="text-[color:var(--ring)]">groups</span>
              </h1>

              <p className="mt-3 max-w-[640px] text-base leading-relaxed text-muted-foreground">
                A fully customizable scheduling platform for families, friend groups, and teams building meaningful connections where everyone can meet together.
              </p>

              <div className="mt-5 flex flex-wrap items-start gap-2.5">
                <div>
                  <Link
                    to="/login"
                    className={cn(
                      buttonVariants({ size: 'lg' }),
                      'h-9 rounded-lg border border-black bg-black px-4 text-xs font-semibold text-white hover:bg-black/90'
                    )}
                  >
                    <img
                      src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                      alt="Google"
                      className="mr-1 size-4"
                    />
                    Sign up with Google
                  </Link>
                  <p className="mt-1 text-[10px] leading-none text-slate-400">No credit card required</p>
                </div>
                <a
                  href="#how-it-works"
                  className={cn(
                    buttonVariants({ size: 'lg' }),
                    'h-9 rounded-lg border border-primary bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90'
                  )}
                >
                  Get started <ArrowRight className="ml-1" />
                </a>
              </div>
            </div>

            <div className="relative left-[10px] justify-self-end w-full max-w-[430px] rounded-3xl border border-border bg-background/90 p-3 shadow-lg shadow-slate-300/30 backdrop-blur-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-bold text-foreground">Team Sync Meeting</p>
                  <p className="text-xs text-muted-foreground">Find time for your group</p>
                </div>
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <Zap className="size-3.5" />
                </div>
              </div>

              <div className="mt-[22px] flex flex-wrap gap-2.5">
                {['30m', '1hr', '1.5hr', '2hr'].map((slot) => (
                  <span
                    key={slot}
                    className="inline-flex h-7 items-center rounded-md border border-input bg-muted px-2.5 text-xs text-foreground transition-all hover:border-transparent hover:ring-2 hover:ring-[color:var(--ring)]"
                  >
                    {slot}
                  </span>
                ))}
              </div>

              <div className="relative mt-3 rounded-xl border border-border bg-card p-3">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => addMonths(prev, -1))}
                    className="absolute left-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <p className="text-center text-base font-bold text-foreground">{format(calendarMonth, 'MMMM yyyy')}</p>
                  <button
                    type="button"
                    onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}
                    className="absolute right-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent"
                    aria-label="Next month"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-7 text-center text-[0.7rem] font-medium text-muted-foreground">
                  {weekdays.map((day) => (
                    <span key={day} className="py-0.5">
                      {day}
                    </span>
                  ))}
                </div>

                <div className="mt-1 grid grid-cols-7 gap-y-0 text-center text-sm">
                  {calendarDays.map((day) => {
                    const isToday = isSameDay(day, new Date())
                    const isSelected = isSameDay(day, currentDay)
                    const inMonth = isSameMonth(day, calendarMonth)
                    return (
                      <span
                        key={day.toISOString()}
                        className={cn(
                          'mx-auto inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                          inMonth ? 'text-foreground' : 'text-muted-foreground/50',
                          'hover:bg-blue-100 hover:text-primary',
                          isSelected && 'bg-primary font-semibold text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                          !isSelected && isToday && 'ring-1 ring-primary/40'
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                    )
                  })}
                </div>

                {/* First pill */}
                <div className="pointer-events-none absolute right-[-56px] top-[67%] z-20 w-[285px] rounded-lg border border-border bg-card p-2 shadow-lg">
                  {(() => {
                    const booking = heroBookings[0]
                    const { label, className } = meetingStatusConfig(booking.status)
                    return (
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{booking.name}</p>
                          <p className="text-[10px] text-muted-foreground">{booking.duration} · {booking.lobby}</p>
                        </div>
                        <div className="ml-1 flex items-center gap-0.5">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
                            {label}
                          </span>
                          <ChevronRight className="size-3 text-muted-foreground" />
                        </div>
                      </div>
                    )
                  })()}
                </div>

                {/* Second pill */}
                <div className="pointer-events-none absolute right-[-16px] top-[calc(86%+15px)] z-20 w-[275px] rounded-lg border border-border bg-card p-2 shadow-lg">
                  {(() => {
                    const booking = heroBookings[1]
                    const { label, className } = meetingStatusConfig(booking.status)
                    return (
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">{booking.name}</p>
                          <p className="text-[10px] text-muted-foreground">{booking.duration} · {booking.lobby}</p>
                        </div>
                        <div className="ml-1 flex items-center gap-0.5">
                          <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${className}`}>
                            {label}
                          </span>
                          <ChevronRight className="size-3 text-muted-foreground" />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="my-12 h-[1.5px] bg-gradient-to-r from-transparent via-neutral-400 to-transparent" />

        <section id="how-it-works" className="scroll-mt-24 py-4">
          <h2 className="text-center text-3xl font-black tracking-tight text-foreground sm:text-5xl">
            How it Works
          </h2>

          <div className="mt-[60px] grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Step 1 - Create a Lobby */}
            <article className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1">
              <div>
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <UsersRound className="size-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary/80">Step 1</p>
                <h3 className="mt-2 text-lg font-bold text-foreground">Create a Lobby</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Start a new lobby and invite your participants with a single shareable link.</p>
              </div>
              <div className="mt-[15px] min-h-[120px] rounded-xl border border-border bg-muted/50 p-3 space-y-2">
                <div className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground">Team Sync Q2</div>
                <div className="flex items-center gap-1 pt-1">
                  {['V', 'T', 'R'].map((initial) => (
                    <div key={initial} className="grid size-5 place-items-center rounded-full bg-primary text-[9px] font-bold text-white">{initial}</div>
                  ))}
                  <span className="ml-1 text-[10px] text-muted-foreground">3 members</span>
                </div>
                <div className="w-full rounded-md bg-primary px-2 py-1 text-center text-[10px] font-semibold text-primary-foreground">Create Lobby</div>
              </div>
            </article>

            {/* Step 2 - Set Your Preferences */}
            <article className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1">
              <div>
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <MousePointer2 className="size-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary/80">Step 2</p>
                <h3 className="mt-2 text-lg font-bold text-foreground">Set Your Preferences</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Each member connects their Google Calendar and configures their work hours and availability.</p>
              </div>
              <div className="mt-[15px] min-h-[120px] rounded-xl border border-border bg-muted/50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Work hours</span>
                  <span className="text-[10px] font-semibold text-foreground">9:00 AM - 5:00 PM</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Buffer time</span>
                  <span className="text-[10px] font-semibold text-foreground">15 min</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">Preferred time</span>
                  <span className="text-[10px] font-semibold text-foreground">Midday</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <div className="flex items-center gap-1">
                    <div className="size-2 rounded-full bg-green-500" />
                    <span className="text-[10px] text-foreground">Google Calendar</span>
                  </div>
                  <span className="text-[10px] font-semibold text-green-600">Connected</span>
                </div>
              </div>
            </article>

            {/* Step 3 - Chronos Finds the Time */}
            <article className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1">
              <div>
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Clock className="size-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary/80">Step 3</p>
                <h3 className="mt-2 text-lg font-bold text-foreground">Chronos Finds the Time</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">The algorithm analyses everyone's calendar and ranks the best meeting slots for the group.</p>
              </div>
              <div className="mt-[15px] min-h-[120px] rounded-xl border border-border bg-muted/50 p-3 space-y-2.5">
                {topSlots.map((slot, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-foreground">{slot.day} · {slot.time}</span>
                      <span className="text-[10px] font-bold text-primary">{slot.score}%</span>
                    </div>
                    <div className="mt-0.5 h-1 rounded-full bg-border">
                      <div className="h-1 rounded-full bg-primary transition-all" style={{ width: `${slot.score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            {/* Step 4 - Book in One Click */}
            <article className="flex flex-col rounded-3xl border border-border/70 bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1">
              <div>
                <div className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <CircleCheck className="size-5" />
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary/80">Step 4</p>
                <h3 className="mt-2 text-lg font-bold text-foreground">Book in One Click</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Pick a slot and Chronos confirms it on every participant's Google Calendar instantly.</p>
              </div>
              <div className="mt-[15px] min-h-[120px] rounded-xl border border-border bg-muted/50 p-3 space-y-2">
                <div className="rounded-md border-2 border-primary bg-primary/10 px-2 py-1.5 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-semibold text-primary">Mon Apr 21 · 2:00 PM</div>
                    <div className="text-[9px] text-muted-foreground">60 min · Score 96%</div>
                  </div>
                  <CircleCheck className="size-4 text-primary" />
                </div>
                <div className="w-full rounded-md bg-primary px-2 py-1 text-center text-[10px] font-semibold text-primary-foreground">Confirm Booking</div>
                <div className="flex items-center gap-1 justify-center pt-0.5">
                  <CircleCheck className="size-3 text-green-500" />
                  <span className="text-[10px] font-medium text-green-600">Added to all calendars</span>
                </div>
              </div>
            </article>
          </div>
        </section>

        <div className="my-12 h-[1.5px] bg-gradient-to-r from-transparent via-neutral-400 to-transparent" />

        <section id="reviews" className="scroll-mt-24 py-4">
          <h2 className="text-center text-3xl font-black tracking-tight text-foreground sm:text-5xl">
            Testimonials
          </h2>

          <div className="mt-[60px] grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((review) => (
              <article
                key={review.name}
                className="rounded-3xl border border-border/70 bg-background p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1"
              >
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-full bg-primary text-sm font-bold text-white">
                    {review.initial}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{review.name}</p>
                    <p className="text-xs text-muted-foreground">{review.role}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1 text-amber-500">
                  <Star className="size-4 fill-current" />
                  <Star className="size-4 fill-current" />
                  <Star className="size-4 fill-current" />
                  <Star className="size-4 fill-current" />
                  <Star className="size-4 fill-current" />
                </div>

                <p className="mt-3 text-sm leading-relaxed text-foreground">&quot;{review.quote}&quot;</p>
              </article>
            ))}
          </div>
        </section>

      </main>

      <MarketingFooter />
    </div>
  )
}
