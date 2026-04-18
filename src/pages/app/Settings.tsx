import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { fetchCalendarTimezone } from '@/lib/calendarTimezone'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const DEFAULT_SETTINGS = {
  bufferMinutes: 15,
  workStart: '09:00',
  workEnd: '17:00',
  workDays: [0, 1, 2, 3, 4],
}

// Full IANA timezone list with UTC offset labels, sorted west→east
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

function toTimeString(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export default function Settings() {
  const user = useAuthStore((state) => state.user)
  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_SETTINGS.bufferMinutes)
  const [workStart, setWorkStart] = useState(DEFAULT_SETTINGS.workStart)
  const [workEnd, setWorkEnd] = useState(DEFAULT_SETTINGS.workEnd)
  const [workDays, setWorkDays] = useState<number[]>(DEFAULT_SETTINGS.workDays)
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) return
    const fetchSettings = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const data = snap.data()
        const s = data.settings ?? {}
        setBufferMinutes(s.bufferMinutes ?? DEFAULT_SETTINGS.bufferMinutes)
        setWorkStart(toTimeString(s.workStartHour ?? 9, s.workStartMinute ?? 0))
        setWorkEnd(toTimeString(s.workEndHour ?? 17, s.workEndMinute ?? 0))
        setWorkDays(s.workDays ?? DEFAULT_SETTINGS.workDays)

        if (s.timezone) {
          setTimezone(s.timezone)
        } else {
          // No timezone stored yet — fetch from Google Calendar and save it
          const token: string = data.googleAccessToken ?? ''
          const calTz = token ? await fetchCalendarTimezone(token) : ''
          const resolved = calTz || Intl.DateTimeFormat().resolvedOptions().timeZone
          setTimezone(resolved)
          await updateDoc(doc(db, 'users', user.uid), { 'settings.timezone': resolved })
        }
      }
      setLoading(false)
    }
    fetchSettings()
  }, [user])

  const toggleDay = (day: number) => {
    setWorkDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    )
  }

  const handleSave = async () => {
    if (!user) return

    const [startHour, startMinute] = workStart.split(':').map(Number)
    const [endHour, endMinute] = workEnd.split(':').map(Number)

    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      toast.error('Work end time must be after start time.')
      return
    }
    if (workDays.length === 0) {
      toast.error('Select at least one work day.')
      return
    }

    setSaving(true)
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          settings: {
            bufferMinutes,
            workStartHour: startHour,
            workStartMinute: startMinute,
            workEndHour: endHour,
            workEndMinute: endMinute,
            workDays,
            timezone,
          },
        },
        { merge: true }
      )
      toast.success('Settings saved!')
    } catch (error) {
      toast.error('Failed to save settings.')
      console.error(error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Settings</h1>
      <p className="text-muted-foreground mb-8">Configure your availability for scheduling.</p>

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="buffer">Buffer time between meetings</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Free time reserved before and after each of your calendar events.
          </p>
          <select
            id="buffer"
            value={bufferMinutes}
            onChange={(e) => setBufferMinutes(Number(e.target.value))}
            className="h-8 w-44 rounded-lg border border-input bg-background px-2.5 text-sm"
          >
            <option value={0}>None</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>1 hour</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Work hours</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Meetings will only be scheduled within this window.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="time"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="timezone">Timezone</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Synced from your Google Calendar on sign-in. Override here if needed.
          </p>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="rounded-lg border border-input bg-background px-2.5 py-1 text-sm w-72"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Work days</Label>
          <p className="text-xs text-muted-foreground mb-1">
            Meetings will only be scheduled on selected days.
          </p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleDay(i)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                  workDays.includes(i)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {day.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-fit">
          {saving ? 'Saving...' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
