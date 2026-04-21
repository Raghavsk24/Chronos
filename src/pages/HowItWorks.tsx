import { ArrowRight, CalendarCheck2, Clock3, MessageSquareText, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import MarketingFooter from '@/components/marketing/MarketingFooter'
import MarketingNav from '@/components/marketing/MarketingNav'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const steps = [
  {
    icon: UsersRound,
    title: 'Create a shared lobby',
    description: 'Start with one invite link so every person in your group can join in under a minute.',
  },
  {
    icon: CalendarCheck2,
    title: 'Collect real availability',
    description: 'Chronos consolidates everyone’s availability to reveal overlapping windows instantly.',
  },
  {
    icon: Clock3,
    title: 'Pick the best slot',
    description: 'Ranked recommendations help your group lock a date and time without endless polling.',
  },
  {
    icon: MessageSquareText,
    title: 'Confirm and notify',
    description: 'Meeting details are shared and reminders are sent so everyone stays aligned.',
  },
]

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_10%_10%,rgba(34,80,214,0.08),transparent_44%),radial-gradient(circle_at_90%_90%,rgba(16,24,40,0.08),transparent_38%)]">
      <MarketingNav />

      <main className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-8">
        <section className="mx-auto max-w-3xl text-center">
          <p className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            How Chronos works
          </p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight text-foreground sm:text-5xl">
            With us, appointment scheduling is easy.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Effortless scheduling for families, friends, and teams that want fast coordination without compromise.
          </p>
          <Link to="/login" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'mt-6 rounded-xl px-5')}>
            Get started <ArrowRight className="ml-1" />
          </Link>
        </section>

        <section className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <article
              key={step.title}
              className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1"
            >
              <step.icon className="size-6 text-primary" />
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary/80">Step {index + 1}</p>
              <h2 className="mt-2 text-xl font-bold text-foreground">{step.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-3xl border border-border/70 bg-card p-8 text-center shadow-sm">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">Ready to schedule in minutes?</h2>
          <p className="mt-2 text-muted-foreground">Create your first lobby and let Chronos do the coordination.</p>
          <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 rounded-xl px-5 font-semibold')}>
            Start for free <ArrowRight className="ml-1" />
          </Link>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
