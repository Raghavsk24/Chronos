import { Crown, Lightbulb, Rocket } from 'lucide-react'
import MarketingFooter from '@/components/marketing/MarketingFooter'
import MarketingNav from '@/components/marketing/MarketingNav'

const team = [
  {
    icon: Crown,
    name: 'Vignesh Nagarajan',
    role: 'Founder & CEO',
    bio: 'Vignesh founded Chronos in May 2025 and drives the company vision, partnerships, and growth.',
  },
  {
    icon: Rocket,
    name: 'Tanay Naik',
    role: 'COO',
    bio: 'Tanay leads operations, social strategy, and investor relations to keep Chronos scaling sustainably.',
  },
  {
    icon: Lightbulb,
    name: 'Raghav Senthil Kumar',
    role: 'CTO',
    bio: 'Raghav owns technical direction and product architecture, shaping a reliable scheduling experience.',
  },
]

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <MarketingNav />

      <main className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-8">
        <section className="rounded-4xl border border-border/70 bg-card p-8 md:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">About Chronos</p>
            <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-foreground sm:text-5xl">
              Our mission
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
              We believe scheduling shouldn&apos;t feel like work, but it should still get done. Chronos exists to turn planning chaos into calm and help people spend less time coordinating and more time connecting.
            </p>
            <div id="contact" className="mt-6 rounded-xl border border-border/80 bg-background p-4 text-sm text-muted-foreground">
              Need help? Reach us at{' '}
              <a href="mailto:team@chronos.app" className="font-semibold text-primary hover:underline">
                team@chronos.app
              </a>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-center text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Meet our team</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {team.map((member) => (
              <article key={member.name} className="rounded-3xl border border-border/70 bg-card p-6 text-center shadow-sm">
                <div className="mx-auto grid size-16 place-items-center rounded-full border-2 border-primary/30 bg-primary/10 text-primary">
                  <member.icon className="size-7" />
                </div>
                <h3 className="mt-4 text-lg font-bold text-foreground">{member.name}</h3>
                <p className="text-sm font-semibold text-primary">{member.role}</p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{member.bio}</p>
              </article>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-muted-foreground">
            We are building Chronos to serve modern teams, families, and communities that care deeply about time together.
          </p>
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
