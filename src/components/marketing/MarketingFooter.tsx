import { Link } from 'react-router-dom'
import ChronosLogo from '@/components/ChronosLogo'

export default function MarketingFooter() {
  return (
    <footer className="mt-16 border-t border-border/70 bg-background/90">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <ChronosLogo height={24} />
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Our mission is to schedule 1M meetings by 2028.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">© {new Date().getFullYear()} Chronos. All rights reserved.</p>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Product</p>
          <ul className="mt-3 space-y-2">
            <li>
              <a href="/#how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                How It Works
              </a>
            </li>
            <li>
              <a href="/#reviews" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Testimonials
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Socials</p>
          <ul className="mt-3 space-y-2">
            <li>
              <a
                href="https://www.linkedin.com/company/chronos-calendar/"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                LinkedIn
              </a>
            </li>
            <li>
              <a
                href="https://hamadeh.house.gov/news/documentsingle.aspx?DocumentID=360"
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Press
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-foreground">Company</p>
          <ul className="mt-3 space-y-2">
            <li>
              <Link to="/login" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Get Started
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
