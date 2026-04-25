import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Popover } from '@base-ui/react/popover'
import { addMonths, format, startOfMonth } from 'date-fns'
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react'
import { auth, db } from '@/lib/firebase'
import { connectGoogleCalendar } from '@/lib/googleCalendarAuth'
import { useAuthStore } from '@/store/authStore'
import Avatar from '@/components/Avatar'
import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const TOTAL_STEPS = 8

const _now = new Date()
const TIMEZONES = Intl.supportedValuesOf('timeZone')
  .map((tz) => {
    const offsetStr =
      new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' })
        .formatToParts(_now)
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
    return { value: tz, label: `(${offsetStr}) ${tz.replace(/_/g, ' ')}`, offsetStr }
  })
  .sort((a, b) => {
    const toMins = (s: string) => {
      if (s === 'GMT') return 0
      const m = s.match(/GMT([+-])(\d+)(?::(\d+))?/)
      if (!m) return 0
      return (m[1] === '+' ? 1 : -1) * (parseInt(m[2]) * 60 + parseInt(m[3] ?? '0'))
    }
    const diff = toMins(a.offsetStr) - toMins(b.offsetStr)
    return diff !== 0 ? diff : a.value.localeCompare(b.value)
  })

function parseTime(value: string): { hour: string; minute: string; period: string } {
  const [h, m] = value.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return {
    hour: String(hour12).padStart(2, '0'),
    minute: String(m).padStart(2, '0'),
    period,
  }
}

function buildTime(hour: string, minute: string, period: string): string {
  let h = parseInt(hour)
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${minute}`
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

export default function Onboarding() {
  const setUser = useAuthStore((state) => state.setUser)
  const setOnboardingComplete = useAuthStore((state) => state.setOnboardingComplete)
  const navigate = useNavigate()

  const [authReady, setAuthReady] = useState(false)
  const [authedUser, setAuthedUser] = useState<User | null>(null)
  const [step, setStep] = useState(1)

  const [dateOfBirth, setDateOfBirth] = useState('')
  const [locationState, setLocationState] = useState('')
  const [city, setCity] = useState('')
  const [company, setCompany] = useState('')
  const [role, setRole] = useState('')
  const [workDays, setWorkDays] = useState<number[]>([0, 1, 2, 3, 4])
  const [workStart, setWorkStart] = useState('09:00')
  const [workEnd, setWorkEnd] = useState('17:00')
  const [bufferMinutes, setBufferMinutes] = useState(15)
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [saving, setSaving] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        navigate('/login', { replace: true })
        return
      }
      setAuthedUser(user)
      setUser(user)

      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const d = snap.data()
        if (d.onboardingComplete) {
          navigate('/app/dashboard', { replace: true })
          return
        }
        setDateOfBirth(d.dateOfBirth ?? '')
        setLocationState(d.state ?? '')
        setCity(d.city ?? '')
        setCompany(d.company ?? '')
        setRole(d.role ?? '')
        if (d.settings) {
          const s = d.settings
          setWorkDays(s.workDays ?? [0, 1, 2, 3, 4])
          if (s.workStartHour != null)
            setWorkStart(
              `${String(s.workStartHour).padStart(2, '0')}:${String(s.workStartMinute ?? 0).padStart(2, '0')}`
            )
          if (s.workEndHour != null)
            setWorkEnd(
              `${String(s.workEndHour).padStart(2, '0')}:${String(s.workEndMinute ?? 0).padStart(2, '0')}`
            )
          setBufferMinutes(s.bufferMinutes ?? 15)
          setTimezone(s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        }
        if (d.googleRefreshToken) setCalendarConnected(true)
      }
      setAuthReady(true)
    })
  }, [navigate, setUser])

  const toggleDay = (day: number) => {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    )
  }

  const handleFinish = async () => {
    if (!authedUser) return
    setSaving(true)
    const [startHour, startMinute] = workStart.split(':').map(Number)
    const [endHour, endMinute] = workEnd.split(':').map(Number)
    try {
      await setDoc(
        doc(db, 'users', authedUser.uid),
        {
          dateOfBirth: dateOfBirth || null,
          state: locationState.trim() || null,
          city: city.trim() || null,
          company: company.trim() || null,
          role: role.trim() || null,
          settings: {
            workDays,
            workStartHour: startHour,
            workStartMinute: startMinute,
            workEndHour: endHour,
            workEndMinute: endMinute,
            bufferMinutes,
            timezone,
          },
          onboardingComplete: true,
        },
        { merge: true }
      )
      setOnboardingComplete(true)
      navigate('/app/dashboard', { replace: true })
    } catch {
      setSaving(false)
    }
  }

  const [startH, startM] = workStart.split(':').map(Number)
  const [endH, endM] = workEnd.split(':').map(Number)
  const workHoursValid = endH * 60 + endM > startH * 60 + startM

  const getAge = (dob: string): number => {
    const birth = new Date(dob)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age
  }

  const dobAge = dateOfBirth ? getAge(dateOfBirth) : null
  const dobTooYoung = dobAge !== null && dobAge < 13

  const canContinue =
    step === 2 ? dateOfBirth !== '' && !dobTooYoung :
    step === 5 ? workDays.length > 0 :
    step === 6 ? workHoursValid :
    step === 8 ? calendarConnected :
    true

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="mb-8 text-center">
        <span className="text-xl font-bold tracking-tight">Chronos</span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-1.5 mb-8">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i + 1 <= step ? 'bg-primary w-8' : 'bg-muted w-5'
            }`}
          />
        ))}
      </div>

      {/* Card */}
      <div className="w-full max-w-md rounded-xl border bg-card shadow-sm p-8">
        {step === 1 && <StepProfile user={authedUser} />}
        {step === 2 && (
          <StepDOB dateOfBirth={dateOfBirth} setDateOfBirth={setDateOfBirth} />
        )}
        {step === 3 && (
          <StepLocation
            locationState={locationState}
            setLocationState={setLocationState}
            city={city}
            setCity={setCity}
          />
        )}
        {step === 4 && (
          <StepWorkProfile
            company={company}
            setCompany={setCompany}
            role={role}
            setRole={setRole}
          />
        )}
        {step === 5 && <StepWorkDays workDays={workDays} toggleDay={toggleDay} />}
        {step === 6 && (
          <StepWorkHours
            workStart={workStart}
            setWorkStart={setWorkStart}
            workEnd={workEnd}
            setWorkEnd={setWorkEnd}
            bufferMinutes={bufferMinutes}
            setBufferMinutes={setBufferMinutes}
            workHoursValid={workHoursValid}
          />
        )}
        {step === 7 && <StepTimezone timezone={timezone} setTimezone={setTimezone} />}
        {step === 8 && (
          <StepCalendar
            isConnected={calendarConnected}
            onConnected={() => setCalendarConnected(true)}
          />
        )}

        <div className="flex items-center justify-between mt-8">
          {step > 1 ? (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <div />
          )}
          <Button
            onClick={() => (step === TOTAL_STEPS ? handleFinish() : setStep((s) => s + 1))}
            disabled={!canContinue || saving}
          >
            {step === TOTAL_STEPS ? (saving ? 'Saving...' : 'Finish Setup') : 'Continue'}
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        Step {step} of {TOTAL_STEPS}
      </p>
    </div>
  )
}

function StepProfile({ user }: { user: User | null }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Welcome to Chronos</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Let's get you set up. First, confirm your profile.
        </p>
      </div>
      <div className="flex items-center gap-4 p-4 rounded-xl border bg-muted/30">
        <Avatar src={user?.photoURL} name={user?.displayName} className="w-12 h-12 text-base" />
        <div>
          <p className="font-semibold">{user?.displayName}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        This information comes from your Google account and cannot be changed here.
      </p>
    </div>
  )
}

function StepDOB({
  dateOfBirth, setDateOfBirth,
}: {
  dateOfBirth: string; setDateOfBirth: (v: string) => void
}) {
  const [open, setOpen] = useState(false)

  const today = new Date()
  const selected = dateOfBirth ? new Date(dateOfBirth + 'T12:00:00') : today
  const minYear = 1920
  const maxYear = today.getFullYear()
  const maxMonth = startOfMonth(today)
  const [calendarMonth, setCalendarMonth] = useState<Date>(() =>
    startOfMonth(selected ?? new Date(2000, 0, 1))
  )

  useEffect(() => {
    if (dateOfBirth) {
      setCalendarMonth(startOfMonth(new Date(dateOfBirth + 'T12:00:00')))
    }
  }, [dateOfBirth])

  const monthIndex = calendarMonth.getMonth()
  const yearValue = calendarMonth.getFullYear()
  const prevMonth = addMonths(calendarMonth, -1)
  const nextMonth = addMonths(calendarMonth, 1)
  const prevDisabled = prevMonth < new Date(minYear, 0, 1)
  const nextDisabled = nextMonth > maxMonth
  const monthLabels = Array.from({ length: 12 }, (_, i) => format(new Date(2020, i, 1), 'MMMM'))
  const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(minYear + i))
  const displayDate = format(selected, 'MMMM d, yyyy')

  const tooYoung = dateOfBirth ? (() => {
    const birth = new Date(dateOfBirth)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const m = today.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
    return age < 13
  })() : false

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">What's your date of birth?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We collect this to verify you meet the minimum age requirements to use Chronos.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Date of birth *</Label>
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger
            className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-foreground font-medium">{displayDate}</span>
            <CalendarIcon className="h-4 w-4 opacity-50 shrink-0" />
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="right" sideOffset={12} align="start">
              <Popover.Popup className="rounded-xl border bg-popover shadow-md z-50">
                <div className="grid grid-cols-7 items-center gap-1 px-3 pt-3">
                  <button
                    type="button"
                    aria-label="Previous month"
                    onClick={() => setCalendarMonth(prevMonth)}
                    disabled={prevDisabled}
                    className="col-start-1 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <div className="col-start-2 col-end-7 flex items-center justify-center gap-2">
                    <Select
                      value={String(monthIndex)}
                      onValueChange={(value) => {
                        if (!value) return
                        const next = new Date(yearValue, parseInt(value), 1)
                        setCalendarMonth(next)
                      }}
                    >
                      <SelectTrigger className="h-8 w-[116px]">
                        <span>{monthLabels[monthIndex]}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {monthLabels.map((label, i) => (
                          <SelectItem
                            key={label}
                            value={String(i)}
                            disabled={yearValue === maxYear && i > maxMonth.getMonth()}
                          >
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={String(yearValue)}
                      onValueChange={(value) => {
                        if (!value) return
                        const nextYear = parseInt(value)
                        const nextMonthIndex = nextYear === maxYear
                          ? Math.min(monthIndex, maxMonth.getMonth())
                          : monthIndex
                        setCalendarMonth(new Date(nextYear, nextMonthIndex, 1))
                      }}
                    >
                      <SelectTrigger className="h-8 w-[88px]">
                        <span>{yearValue}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((year) => (
                          <SelectItem key={year} value={year}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                    <button
                      type="button"
                      aria-label="Next month"
                      onClick={() => setCalendarMonth(nextMonth)}
                      disabled={nextDisabled}
                      className="col-start-7 justify-self-center h-7 w-7 inline-flex items-center justify-center rounded-md border border-input bg-transparent opacity-50 hover:opacity-100 hover:bg-accent hover:text-accent-foreground transition-colors disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
                <Calendar
                  mode="single"
                  selected={selected}
                  onSelect={(date) => {
                    if (date) {
                      setDateOfBirth(format(date, 'yyyy-MM-dd'))
                      setCalendarMonth(startOfMonth(date))
                      setOpen(false)
                    }
                  }}
                  disabled={{ after: new Date() }}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  fromYear={minYear}
                  toYear={maxYear}
                  className="pt-0"
                  classNames={{
                    month_caption: 'hidden',
                    nav: 'hidden',
                    caption_label: 'hidden',
                  }}
                />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
        {tooYoung && (
          <p className="text-xs text-destructive">
            You must be at least 13 years old to use Chronos.
          </p>
        )}
      </div>
    </div>
  )
}

function StepLocation({
  locationState, setLocationState, city, setCity,
}: {
  locationState: string; setLocationState: (v: string) => void
  city: string; setCity: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          Where are you located?{' '}
          <span className="text-sm font-normal text-muted-foreground">(optional)</span>
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Knowing your location helps us understand where your team is working from.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ob-state">State / Province</Label>
          <Input
            id="ob-state"
            placeholder="e.g. California"
            value={locationState}
            onChange={(e) => setLocationState(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ob-city">City</Label>
          <Input
            id="ob-city"
            placeholder="e.g. San Francisco"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

function StepWorkProfile({
  company, setCompany, role, setRole,
}: {
  company: string; setCompany: (v: string) => void
  role: string; setRole: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">
          Tell us about your work{' '}
          <span className="text-sm font-normal text-muted-foreground">(optional)</span>
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          This helps your teammates understand who you are when scheduling together.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ob-company">Company / Organization</Label>
          <Input
            id="ob-company"
            placeholder="e.g. Acme Corp"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ob-role">Role</Label>
          <Input
            id="ob-role"
            placeholder="e.g. Product Manager"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

function StepWorkDays({
  workDays, toggleDay,
}: {
  workDays: number[]; toggleDay: (d: number) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Which days do you work?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Only selected days will be considered for scheduling.
        </p>
      </div>
      <div className="flex gap-1.5">
        {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
          (day, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                workDays.includes(i)
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              {day.slice(0, 3)}
            </button>
          )
        )}
      </div>
      {workDays.length === 0 && (
        <p className="text-xs text-destructive">Select at least one day to continue.</p>
      )}
    </div>
  )
}

function TimePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { hour, minute, period } = parseTime(value)
  const update = (h: string, m: string, p: string) => onChange(buildTime(h, m, p))

  return (
    <div className="flex items-center gap-1.5">
      <Select value={hour} onValueChange={(v) => { if (v) update(v, minute, period) }}>
        <SelectTrigger className="w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground font-medium">:</span>
      <Select value={minute} onValueChange={(v) => { if (v) update(hour, v, period) }}>
        <SelectTrigger className="w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>{m}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={period} onValueChange={(v) => { if (v) update(hour, minute, v) }}>
        <SelectTrigger className="w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AM">AM</SelectItem>
          <SelectItem value="PM">PM</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function StepWorkHours({
  workStart, setWorkStart, workEnd, setWorkEnd,
  bufferMinutes, setBufferMinutes, workHoursValid,
}: {
  workStart: string; setWorkStart: (v: string) => void
  workEnd: string; setWorkEnd: (v: string) => void
  bufferMinutes: number; setBufferMinutes: (v: number) => void
  workHoursValid: boolean
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">What are your work hours?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Meetings will only be scheduled within this window.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Start time</Label>
          <TimePicker value={workStart} onChange={setWorkStart} />
        </div>
        <div className="flex flex-col gap-2">
          <Label>End time</Label>
          <TimePicker value={workEnd} onChange={setWorkEnd} />
          {!workHoursValid && (
            <p className="text-xs text-destructive">End time must be after start time.</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label>Buffer time</Label>
          <p className="text-xs text-muted-foreground">
            Breathing room reserved before and after each calendar event.
          </p>
          <Select
            value={String(bufferMinutes)}
            onValueChange={(v) => { if (v) setBufferMinutes(Number(v)) }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">None</SelectItem>
              <SelectItem value="5">5 minutes</SelectItem>
              <SelectItem value="10">10 minutes</SelectItem>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
              <SelectItem value="45">45 minutes</SelectItem>
              <SelectItem value="60">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function StepTimezone({
  timezone, setTimezone,
}: {
  timezone: string; setTimezone: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Confirm your timezone</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Auto-detected from your device. Override here if needed.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ob-tz">Timezone</Label>
        <select
          id="ob-tz"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm w-full"
        >
          {TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" className={className}>
      <polygon fill="#FFFFFF" points="195.368421 60.6315789 60.6315789 60.6315789 60.6315789 195.368421 195.368421 195.368421" />
      <polygon fill="#EA4335" points="195.368421 256 256 195.368421 225.684211 190.196005 195.368421 195.368421 189.835162 223.098002" />
      <path d="M0,195.368421 L0,235.789474 C0,246.955789 9.04421053,256 20.2105263,256 L60.6315789,256 L66.8568645,225.684211 L60.6315789,195.368421 L27.5991874,190.196005 L0,195.368421 Z" fill="#188038" />
      <path d="M256,60.6315789 L256,20.2105263 C256,9.04421053 246.955789,0 235.789474,0 L195.368421,0 C191.679582,15.0358547 189.835162,26.1010948 189.835162,33.1957202 C189.835162,40.2903456 191.679582,49.4356319 195.368421,60.6315789 C208.777986,64.4714866 218.883249,66.3914404 225.684211,66.3914404 C232.485172,66.3914404 242.590435,64.4714866 256,60.6315789 Z" fill="#1967D2" />
      <polygon fill="#FBBC04" points="256 60.6315789 195.368421 60.6315789 195.368421 195.368421 256 195.368421" />
      <polygon fill="#34A853" points="195.368421 195.368421 60.6315789 195.368421 60.6315789 256 195.368421 256" />
      <path d="M195.368421,0 L20.2105263,0 C9.04421053,0 0,9.04421053 0,20.2105263 L0,195.368421 L60.6315789,195.368421 L60.6315789,60.6315789 L195.368421,60.6315789 L195.368421,0 Z" fill="#4285F4" />
      <path d="M88.2694737,165.153684 C83.2336842,161.751579 79.7473684,156.783158 77.8442105,150.214737 L89.5326316,145.397895 C90.5936842,149.44 92.4463158,152.572632 95.0905263,154.795789 C97.7178947,157.018947 100.917895,158.113684 104.656842,158.113684 C108.48,158.113684 111.764211,156.951579 114.509474,154.627368 C117.254737,152.303158 118.635789,149.338947 118.635789,145.751579 C118.635789,142.08 117.187368,139.082105 114.290526,136.757895 C111.393684,134.433684 107.755789,133.271579 103.410526,133.271579 L96.6568421,133.271579 L96.6568421,121.701053 L102.72,121.701053 C106.458947,121.701053 109.608421,120.690526 112.168421,118.669474 C114.728421,116.648421 116.008421,113.886316 116.008421,110.366316 C116.008421,107.233684 114.863158,104.741053 112.572632,102.871579 C110.282105,101.002105 107.385263,100.058947 103.865263,100.058947 C100.429474,100.058947 97.7010526,100.968421 95.68,102.804211 C93.6602819,104.644885 92.1418208,106.968942 91.2673684,109.557895 L79.6968421,104.741053 C81.2294737,100.395789 84.0421053,96.5557895 88.1684211,93.2378947 C92.2947368,89.92 97.5663158,88.2526316 103.966316,88.2526316 C108.698947,88.2526316 112.96,89.1621053 116.732632,90.9978947 C120.505263,92.8336842 123.469474,95.3768421 125.608421,98.6105263 C127.747368,101.861053 128.808421,105.498947 128.808421,109.541053 C128.808421,113.667368 127.814737,117.153684 125.827368,120.016842 C123.84,122.88 121.397895,125.069474 118.501053,126.602105 L118.501053,127.292632 C122.241568,128.834789 125.490747,131.367752 127.898947,134.618947 C130.341053,137.903158 131.570526,141.827368 131.570526,146.408421 C131.570526,150.989474 130.408421,155.082105 128.084211,158.669474 C125.76,162.256842 122.543158,165.086316 118.467368,167.141053 C114.374737,169.195789 109.776842,170.240124 104.673684,170.240124 C98.7621053,170.256842 93.3052632,168.555789 88.2694737,165.153684 Z M160.067368,107.149474 L147.233684,116.429474 L140.816842,106.694737 L163.84,90.0884211 L172.665263,90.0884211 L172.665263,168.421053 L160.067368,168.421053 L160.067368,107.149474 Z" fill="#4285F4" />
    </svg>
  )
}

function StepCalendar({
  isConnected,
  onConnected,
}: {
  isConnected: boolean
  onConnected: () => void
}) {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  const handleConnect = async () => {
    if (!user) return
    setConnecting(true)
    setError('')
    try {
      await connectGoogleCalendar()
      onConnected()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect Google Calendar.'
      setError(message)
    } finally {
      setConnecting(false)
    }
  }

  if (isConnected) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Your Google Calendar is connected</h2>
          <p className="text-sm text-muted-foreground mt-1">Chronos is ready to start scheduling.</p>
        </div>
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-16 h-16 flex items-center justify-center">
            <GoogleCalendarIcon className="w-14 h-14" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-sm font-medium">Calendar access granted</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Chronos will read your events to better understand your availability and send calendar
              invites to your inbox when meetings are booked.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Connect Google Calendar</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Chronos needs access to your Google Calendar to find available times and book meetings.
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 py-6">
        <div className="w-16 h-16 flex items-center justify-center">
          <GoogleCalendarIcon className="w-14 h-14" />
        </div>
        <div className="text-center max-w-xs flex flex-col gap-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Chronos will read your calendar events to check availability and create meeting invites on your behalf.
          </p>
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Connecting...' : 'Connect Google Calendar'}
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  )
}
