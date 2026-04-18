import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import { X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface Props {
  onCreated: () => void
}

type DayPart = 'morning' | 'midday' | 'afternoon'

function parseDateInput(raw: string): string | null {
  const d = new Date(raw)
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

export default function CreateLobbyModal({ onCreated }: Props) {
  const user = useAuthStore((state) => state.user)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // Group
  const [lobbyName, setLobbyName] = useState('')
  const [lobbyDescription, setLobbyDescription] = useState('')

  // Meeting
  const [meetingName, setMeetingName] = useState('')
  const [meetingDescription, setMeetingDescription] = useState('')
  const [duration, setDuration] = useState('60')
  const [meetingLink, setMeetingLink] = useState('')

  // Preferences
  const [dayPart, setDayPart] = useState<DayPart | null>(null)
  const [targetingDate, setTargetingDate] = useState(false)
  const [targetDates, setTargetDates] = useState<string[]>([])
  const [dateInput, setDateInput] = useState('')
  const [extraBuffer, setExtraBuffer] = useState(false)

  const reset = () => {
    setLobbyName(''); setLobbyDescription(''); setMeetingName('')
    setMeetingDescription(''); setDuration('60'); setMeetingLink('')
    setDayPart(null); setTargetingDate(false); setTargetDates([])
    setDateInput(''); setExtraBuffer(false)
  }

  const addTargetDate = () => {
    const iso = parseDateInput(dateInput.trim())
    if (!iso) { toast.error('Invalid date. Try formats like 1/20/2026.'); return }
    if (!targetDates.includes(iso)) setTargetDates((prev) => [...prev, iso])
    setDateInput('')
  }

  const handleCreate = async () => {
    if (!lobbyName.trim() || !meetingName.trim() || !user) return
    setLoading(true)
    try {
      const hostMember = {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      }
      const lobbyRef = await addDoc(collection(db, 'lobbies'), {
        name: lobbyName.trim(),
        description: lobbyDescription.trim() || null,
        hostUid: user.uid,
        hostName: user.displayName,
        members: [hostMember],
        memberUids: [user.uid],
        createdAt: new Date(),
      })

      const preferences: Record<string, unknown> = {}
      if (dayPart) preferences.dayPart = dayPart
      if (targetingDate && targetDates.length > 0) preferences.targetDates = targetDates
      if (extraBuffer) preferences.extraBuffer = true

      await addDoc(collection(db, 'meetings'), {
        lobbyId: lobbyRef.id,
        lobbyName: lobbyName.trim(),
        name: meetingName.trim(),
        description: meetingDescription.trim() || null,
        duration: Number(duration),
        meetingLink: meetingLink.trim() || null,
        status: 'scheduling',
        memberUids: [user.uid],
        members: [hostMember],
        hostUid: user.uid,
        hostName: user.displayName,
        preferences: Object.keys(preferences).length > 0 ? preferences : null,
        createdAt: new Date(),
        createdBy: user.uid,
      })

      toast.success('Lobby created!')
      reset()
      setOpen(false)
      onCreated()
    } catch (error) {
      toast.error('Failed to create lobby.')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const dayPartOptions: { value: DayPart; label: string }[] = [
    { value: 'morning', label: 'Morning' },
    { value: 'midday', label: 'Midday' },
    { value: 'afternoon', label: 'Afternoon' },
  ]

  const canSubmit = lobbyName.trim() && meetingName.trim() && !loading

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>New Lobby</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a Lobby</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-2">
          {/* Group */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Group</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lobby-name">Lobby name *</Label>
              <Input id="lobby-name" placeholder="e.g. Design Team" value={lobbyName} onChange={(e) => setLobbyName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lobby-desc">Description</Label>
              <textarea
                id="lobby-desc"
                rows={2}
                placeholder="What is this group for?"
                value={lobbyDescription}
                onChange={(e) => setLobbyDescription(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>

          <div className="border-t" />

          {/* Meeting */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">First Meeting</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meeting-name">Meeting name *</Label>
              <Input id="meeting-name" placeholder="e.g. Project Kickoff" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="meeting-desc">Description</Label>
              <textarea
                id="meeting-desc"
                rows={2}
                placeholder="What is this meeting about?"
                value={meetingDescription}
                onChange={(e) => setMeetingDescription(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <Label htmlFor="duration">Duration</Label>
                <select
                  id="duration"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                >
                  <option value="30">30 min</option>
                  <option value="60">1 hour</option>
                  <option value="90">1.5 hours</option>
                  <option value="120">2 hours</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 flex-1">
                <Label htmlFor="meeting-link">Meeting link</Label>
                <Input id="meeting-link" type="url" placeholder="https://meet.google.com/..." value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t" />

          {/* Preferences */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Scheduling Preferences</p>

            <div className="flex flex-col gap-1.5">
              <Label>Preferred time of day</Label>
              <div className="flex gap-2">
                {dayPartOptions.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setDayPart((prev) => prev === value ? null : value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                      dayPart === value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background text-muted-foreground border-input hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label>Targeting a specific date?</Label>
                <button
                  type="button"
                  onClick={() => setTargetingDate((v) => !v)}
                  className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${
                    targetingDate ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                      targetingDate ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              {targetingDate && (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. 1/20/2026"
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTargetDate()}
                    />
                    <Button variant="outline" onClick={addTargetDate} disabled={!dateInput.trim()}>
                      Add
                    </Button>
                  </div>
                  {targetDates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {targetDates.map((iso) => (
                        <Badge key={iso} variant="secondary" className="gap-1">
                          {formatDisplayDate(iso)}
                          <button
                            type="button"
                            onClick={() => setTargetDates((prev) => prev.filter((d) => d !== iso))}
                            className="hover:text-destructive"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label>Add 30-min buffer</Label>
                <p className="text-xs text-muted-foreground">In case the meeting runs over</p>
              </div>
              <button
                type="button"
                onClick={() => setExtraBuffer((v) => !v)}
                className={`relative inline-flex h-5 w-9 rounded-full border-2 border-transparent transition-colors ${
                  extraBuffer ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    extraBuffer ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <Button onClick={handleCreate} disabled={!canSubmit}>
            {loading ? 'Creating...' : 'Create Lobby'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
