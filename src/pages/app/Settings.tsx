import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, deleteDoc, deleteField } from 'firebase/firestore'
import {
  deleteUser,
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
} from 'firebase/auth'
import { RefreshCcw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { db, auth, googleProvider } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
  const [emailReminderOneHour, setEmailReminderOneHour] = useState(false)
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncingCalendar, setSyncingCalendar] = useState(false)
  const [disconnectingCalendar, setDisconnectingCalendar] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showDisconnectCalendarConfirm, setShowDisconnectCalendarConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!user) return
    const fetchSettings = async () => {
      const snap = await getDoc(doc(db, 'users', user.uid))
      if (snap.exists()) {
        const data = snap.data()
        const s = snap.data().settings ?? {}
        setBufferMinutes(s.bufferMinutes ?? DEFAULT_SETTINGS.bufferMinutes)
        setWorkStart(toTimeString(s.workStartHour ?? 9, s.workStartMinute ?? 0))
        setWorkEnd(toTimeString(s.workEndHour ?? 17, s.workEndMinute ?? 0))
        setWorkDays(s.workDays ?? DEFAULT_SETTINGS.workDays)
        setTimezone(s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        setEmailReminderOneHour(Boolean(s.emailReminderOneHour))
        setGoogleCalendarConnected(Boolean(data.googleAccessToken))
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
            emailReminderOneHour,
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

  const handleReconnectCalendar = async () => {
    if (!user || !auth.currentUser) return
    setSyncingCalendar(true)
    try {
      const result = await reauthenticateWithPopup(auth.currentUser, googleProvider)
      const popupEmail = result.user.email?.toLowerCase()
      const accountEmail = user.email?.toLowerCase()
      if (popupEmail && accountEmail && popupEmail !== accountEmail) {
        toast.error('Use the Google account that matches your login email/password account.')
        return
      }
      const accessToken = GoogleAuthProvider.credentialFromResult(result)?.accessToken
      if (!accessToken) {
        toast.error('Unable to get Google Calendar access. Please try again.')
        return
      }

      await setDoc(
        doc(db, 'users', user.uid),
        {
          googleAccessToken: accessToken,
          tokenUpdatedAt: new Date(),
        },
        { merge: true }
      )
      setGoogleCalendarConnected(true)
      toast.success('Google Calendar connected.')
    } catch {
      toast.error('Google Calendar reconnect failed. Please try again.')
    } finally {
      setSyncingCalendar(false)
    }
  }

  const handleDisconnectCalendar = async () => {
    if (!user) return
    setDisconnectingCalendar(true)
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          googleAccessToken: deleteField(),
          tokenUpdatedAt: deleteField(),
        },
        { merge: true }
      )
      setGoogleCalendarConnected(false)
      toast.success('Google Calendar disconnected.')
      setShowDisconnectCalendarConfirm(false)
    } catch {
      toast.error('Failed to disconnect Google Calendar.')
    } finally {
      setDisconnectingCalendar(false)
    }
  }

  const handleChangePassword = async () => {
    if (!user || !auth.currentUser) return
    if (!user.email) {
      toast.error('No email found for this account.')
      return
    }
    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast.error('Enter current password and new password fields.')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New passwords do not match.')
      return
    }

    setChangingPassword(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      toast.success('Password updated.')
    } catch {
      toast.error('Unable to change password. Check your current password and try again.')
    } finally {
      setChangingPassword(false)
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
      <div className="max-w-5xl mx-auto px-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground mb-8">Manage your availability and account.</p>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1px_1fr] lg:gap-0">

          {/* Availability */}
          <div className="lg:pr-10">
            <Section
              title="Availability"
              description="Controls when meetings can be scheduled for you."
            >
            <div className="border rounded-xl divide-y">

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

              {/* Work hours */}
              <div className="p-4 flex flex-col gap-2">
                <Label>Work hours</Label>
                <p className="text-xs text-muted-foreground">Meetings will only be scheduled within this window.</p>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <TimePicker value={workStart} onChange={setWorkStart} />
                  <span className="text-sm text-muted-foreground">to</span>
                  <TimePicker value={workEnd} onChange={setWorkEnd} />
                </div>
              </div>

              {/* Buffer time */}
              <div className="p-4 flex flex-col gap-2">
                <Label htmlFor="buffer">Buffer time</Label>
                <p className="text-xs text-muted-foreground">Breathing room reserved before and after each calendar event.</p>
                <div className="mt-1">
                  <Select
                    value={String(bufferMinutes)}
                    onValueChange={(v) => { if (v) setBufferMinutes(Number(v)) }}
                  >
                    <SelectTrigger id="buffer" className="h-8 w-40">
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

              {/* Timezone */}
              <div className="p-4 flex flex-col gap-2">
                <Label htmlFor="timezone">Timezone</Label>
                <p className="text-xs text-muted-foreground">Auto-detected from your device. Override here if needed.</p>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm w-72 mt-1"
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
          </div>

          {/* Divider */}
          <div className="hidden lg:block bg-border" />

          {/* Account Settings */}
          <div className="lg:pl-10">
            <Section
              title="Account Settings"
              description="Manage your account and data."
            >
            <div className="border rounded-xl p-4 flex flex-col gap-4">
              <div className="border rounded-lg p-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Google Calendar connection</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Status: {googleCalendarConnected ? 'Connected' : 'Not connected'}
                  </p>
                </div>
                {googleCalendarConnected ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setShowDisconnectCalendarConfirm(true)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReconnectCalendar}
                    disabled={syncingCalendar}
                    className="gap-1.5"
                  >
                    <RefreshCcw className="size-3.5" />
                    {syncingCalendar ? 'Reconnecting...' : 'Reconnect'}
                  </Button>
                )}
              </div>

              <div className="border rounded-lg p-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Email reminders</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Send an email reminder 1 hour before a scheduled meeting.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEmailReminderOneHour((v) => !v)}
                  className={`relative inline-flex h-5 w-9 rounded-full border border-transparent transition-colors ${
                    emailReminderOneHour ? 'bg-primary' : 'bg-muted'
                  }`}
                  aria-label="Toggle one-hour email reminders"
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      emailReminderOneHour ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="border rounded-lg p-3 flex flex-col gap-2.5">
                <p className="text-sm font-medium">Change password</p>
                <p className="text-xs text-muted-foreground">
                  Requires your current password. This is only for accounts with email/password enabled.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <Input
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Button variant="outline" size="sm" onClick={handleChangePassword} disabled={changingPassword}>
                    {changingPassword ? 'Updating...' : 'Update password'}
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg p-3 flex items-center justify-between gap-4">
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
            </div>
            </Section>
          </div>

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

      <Dialog open={showDisconnectCalendarConfirm} onOpenChange={setShowDisconnectCalendarConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Google Calendar?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Chronos needs Google Calendar to schedule accurately. If you disconnect, your availability is ignored by the scheduling algorithm and your meetings may be excluded from matching.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDisconnectCalendarConfirm(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDisconnectCalendar} disabled={disconnectingCalendar}>
              {disconnectingCalendar ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
