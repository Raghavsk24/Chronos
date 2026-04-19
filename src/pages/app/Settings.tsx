import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { deleteUser } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { db, auth } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const DEFAULT_SETTINGS = {
  bufferMinutes: 15,
  workStart: '09:00',
  workEnd: '17:00',
  workDays: [0, 1, 2, 3, 4],
}

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

function Section({ title, description, children }: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export default function Settings() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  const [bufferMinutes, setBufferMinutes] = useState(DEFAULT_SETTINGS.bufferMinutes)
  const [workStart, setWorkStart] = useState(DEFAULT_SETTINGS.workStart)
  const [workEnd, setWorkEnd] = useState(DEFAULT_SETTINGS.workEnd)
  const [workDays, setWorkDays] = useState<number[]>(DEFAULT_SETTINGS.workDays)
  const [timezone, setTimezone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!user) return
    const fetchSettings = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const s = snap.data().settings ?? {}
        setBufferMinutes(s.bufferMinutes ?? DEFAULT_SETTINGS.bufferMinutes)
        setWorkStart(toTimeString(s.workStartHour ?? 9, s.workStartMinute ?? 0))
        setWorkEnd(toTimeString(s.workEndHour ?? 17, s.workEndMinute ?? 0))
        setWorkDays(s.workDays ?? DEFAULT_SETTINGS.workDays)
        setTimezone(s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
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
      toast.success('Settings saved.')
    } catch {
      toast.error('Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user || !auth.currentUser) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'users', user.uid))
      await deleteUser(auth.currentUser)
      navigate('/')
    } catch {
      toast.error('Failed to delete account. You may need to sign in again first.')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-3.5rem)] flex items-start p-8">
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
      <div className="max-w-lg px-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground mb-8">Manage your availability and account.</p>

        <div className="flex flex-col gap-8">

          {/* Availability */}
          <Section
            title="Availability"
            description="Controls when meetings can be scheduled for you."
          >
            <div className="border-2 rounded-xl divide-y">

              {/* Work days */}
              <div className="p-4 flex flex-col gap-2">
                <Label>Work days</Label>
                <p className="text-xs text-muted-foreground">Only selected days will be considered for scheduling.</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {DAYS.map((day, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => toggleDay(i)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium border-2 transition-colors ${
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

              {/* Work hours */}
              <div className="p-4 flex flex-col gap-2">
                <Label>Work hours</Label>
                <p className="text-xs text-muted-foreground">Meetings will only be scheduled within this window.</p>
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="time"
                    value={workStart}
                    onChange={(e) => setWorkStart(e.target.value)}
                    className="h-8 rounded-lg border-2 border-input bg-background px-2.5 text-sm"
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <input
                    type="time"
                    value={workEnd}
                    onChange={(e) => setWorkEnd(e.target.value)}
                    className="h-8 rounded-lg border-2 border-input bg-background px-2.5 text-sm"
                  />
                </div>
              </div>

              {/* Buffer time */}
              <div className="p-4 flex flex-col gap-2">
                <Label htmlFor="buffer">Buffer time</Label>
                <p className="text-xs text-muted-foreground">Breathing room reserved before and after each calendar event.</p>
                <select
                  id="buffer"
                  value={bufferMinutes}
                  onChange={(e) => setBufferMinutes(Number(e.target.value))}
                  className="h-8 w-40 rounded-lg border-2 border-input bg-background px-2.5 text-sm mt-1"
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

              {/* Timezone */}
              <div className="p-4 flex flex-col gap-2">
                <Label htmlFor="timezone">Timezone</Label>
                <p className="text-xs text-muted-foreground">Auto-detected from your device. Override here if needed.</p>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-8 rounded-lg border-2 border-input bg-background px-2.5 text-sm w-72 mt-1"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-fit">
              {saving ? 'Saving...' : 'Save settings'}
            </Button>
          </Section>

          <div className="border-t" />

          {/* Account */}
          <Section
            title="Account"
            description="Manage your account and data."
          >
            <div className="border-2 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Delete account</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permanently removes your account and all associated data. This cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                className="shrink-0"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete
              </Button>
            </div>
          </Section>

        </div>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes your account and all your data. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete my account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
