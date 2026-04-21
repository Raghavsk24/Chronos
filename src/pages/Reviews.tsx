import { Heart, Star } from 'lucide-react'
import MarketingFooter from '@/components/marketing/MarketingFooter'
import MarketingNav from '@/components/marketing/MarketingNav'

const reviews = [
  {
    quote: 'Our team bonding has never been stronger. Chronos finds activities we all love and time we can all make.',
    author: 'Mike Chen',
    role: 'Team Lead',
    initial: 'M',
  },
  {
    quote: 'Coordinating everyone’s availability for community events used to take days. Now it takes minutes.',
    author: 'Lisa Rodriguez',
    role: 'Community Organizer',
    initial: 'L',
  },
  {
    quote: 'Chronos removed the back-and-forth. We pick a time once, and everyone is instantly aligned.',
    author: 'Sofia Kareem',
    role: 'Operations Manager',
    initial: 'S',
  },
  {
    quote: 'Family planning is finally peaceful. We spend less time coordinating and more time actually meeting.',
    author: 'Ethan Park',
    role: 'Parent',
    initial: 'E',
  },
]

export default function Reviews() {
  return (
    <div className="min-h-screen bg-muted/20">
      <MarketingNav />

      <main className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-8">
        <section className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-foreground">
            <Heart className="size-3.5 text-rose-500" /> Wall of love
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight tracking-tight text-foreground sm:text-5xl">
            See why our users love Chronos.
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Read the impact we&apos;ve had from those who matter most: our customers.
          </p>
        </section>

        <section className="mt-12 flex gap-6 overflow-x-auto pb-2">
          {reviews.map((review) => (
            <article
              key={review.author}
              className="min-w-[280px] flex-1 rounded-3xl border border-border/70 bg-background p-6 shadow-sm sm:min-w-[320px]"
            >
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-full border border-primary/20 bg-primary/10 text-sm font-bold text-primary">
                  {review.initial}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{review.author}</p>
                  <p className="text-xs text-muted-foreground">{review.role}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 text-amber-500">
                <Star className="size-4 fill-current" />
                <Star className="size-4 fill-current" />
                <Star className="size-4 fill-current" />
                <Star className="size-4 fill-current" />
                <Star className="size-4 fill-current" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-foreground">“{review.quote}”</p>
            </article>
          ))}
        </section>
      </main>

      <MarketingFooter />
    </div>
  )
}
