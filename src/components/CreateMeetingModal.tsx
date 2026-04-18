import { useState, useEffect } from 'react'
import { collection, addDoc, getDocs, query, where, doc, getDoc } from 'firebase/firestore'
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

interface LobbyOption {
  id: string
  name: string
  memberUids: string[]
  members: { uid: string; displayName: string; email: string; photoURL: string }[]
  hostUid: string
  hostName: string
}

interface Props {
  onCreated: () => void
  defaultLobbyId?: string
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

export default function CreateMeetingModal({ onCreated, defaultLobbyId }: Props) {
  const user = useAuthStore((state) => state.user)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [lobbies, setLobbies] = useState<LobbyOption[]>([])
  const [loadingLobbies, setLoadingLobbies] = useState(false)

  // Step 1
  const [selectedLobbyId, setSelectedLobbyId] = useState(defaultLobbyId ?? '')

  // Meeting details
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

  useEffect(() => {
    if (!open || !user) return
    const fetchLobbies = async () => {
      setLoadingLobbies(true)
      try {
        const snap = await getDocs(
          query(collection(db, 'lobbies'), where('memberUids', 'array-contains', user.uid))
        )
        setLobbies(snap.docs.map((d) => ({ id: d.id, ...d.data() } as LobbyOption)))
      } finally {
        setLoadingLobbies(false)
      }
    }
    fetchLobbies()
  }, [open, user])

  const reset = () => {
    setSelectedLobbyId(defaultLobbyId ?? ''); setMeetingName(''); setMeetingDescription('')
    setDuration('60'); setMeetingLink(''); setDayPart(null)
    setTargetingDate(false); setTargetDates([]); setDateInput(''); setExtraBuffer(false)
  }

  const addTargetDate = () => {
    const iso = parseDateInput(dateInput.trim())
    if (!iso) { toast.error('Invalid date. Try formats like 1/20/2026.'); return }
    if (!targetDates.includes(iso)) setTargetDates((prev) => [...prev, iso])
    setDateInput('')
  }

  const handleCreate = async () => {
    if (!selectedLobbyId || !meetingName.trim() || !user) return
    setLoading(true)
    try {
      const lobbySnap = await getDoc(doc(db, 'lobbies', selectedLobbyId))
      if (!lobbySnap.exists()) { toast.error('Lobby not found.'); return }
      const lobby = lobbySnap.data() as LobbyOption

      const preferences: Record<string, unknown> = {}
      if (dayPart) preferences.dayPart = dayPart
      if (targetingDate && targetDates.length > 0) preferences.targetDates = targetDates
      if (extraBuffer) preferences.extraBuffer = true

      await addDoc(collection(db, 'meetings'), {
        lobbyId: selectedLobbyId,
        lobbyName: lobby.name,
        name: meetingName.trim(),
        description: meetingDescription.trim() || null,
        duration: Number(duration),
        meetingLink: meetingLink.trim() || null,
        status: 'scheduling',
        memberUids: lobby.memberUids,
        members: lobby.members,
        hostUid: lobby.hostUid,
        hostName: lobby.hostName,
        preferences: Object.keys(preferences).length > 0 ? preferences : null,
        createdAt: new Date(),
        createdBy: user.uid,
      })

      toast.success('Meeting created!')
      reset()
      setOpen(false)
      onCreated()
    } catch (error) {
      toast.error('Failed to create meeting.')
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

  const canSubmit = selectedLobbyId && meetingName.trim() && !loading

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>New Meeting</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a Meeting</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 mt-2">
          {/* Lobby selection — hidden when a default lobby is pre-selected */}
          {!defaultLobbyId && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lobby-select">Select a lobby *</Label>
                {loadingLobbies ? (
                  <p className="text-sm text-muted-foreground">Loading lobbies...</p>
                ) : lobbies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No lobbies found. Create one first.</p>
                ) : (
                  <select
                    id="lobby-select"
                    value={selectedLobbyId}
                    onChange={(e) => setSelectedLobbyId(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    <option value="">Choose a lobby...</option>
                    {lobbies.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="border-t" />
            </>
          )}

          {/* Meeting details */}
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Meeting Details</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-name">Meeting name *</Label>
              <Input id="m-name" placeholder="e.g. Weekly Sync" value={meetingName} onChange={(e) => setMeetingName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="m-desc">Description</Label>
              <textarea
                id="m-desc"
                rows={2}
                placeholder="What is this meeting about?"
                value={meetingDescription}
                onChange={(e) => setMeetingDescription(e.target.value)}
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-col gap-1.5 flex-1">
                <Label htmlFor="m-duration">Duration</Label>
                <select
                  id="m-duration"
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
                <Label htmlFor="m-link">Meeting link</Label>
                <Input id="m-link" type="url" placeholder="https://meet.google.com/..." value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} />
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
            {loading ? 'Creating...' : 'Create Meeting'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
