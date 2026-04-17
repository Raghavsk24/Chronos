import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export default function CreateLobbyModal({ onCreated }: Props) {
  const user = useAuthStore((state) => state.user)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('60')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim() || !user) return
    setLoading(true)

    try {
      await addDoc(collection(db, 'lobbies'), {
        name: name.trim(),
        hostUid: user.uid,
        hostName: user.displayName,
        members: [
          {
            uid: user.uid,
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
          },
        ],
        memberUids: [user.uid],
        meetingDuration: Number(duration),
        status: 'open',
        createdAt: new Date(),
      })

      toast.success('Lobby created!')
      setName('')
      setDuration('60')
      setOpen(false)
      onCreated()
    } catch (error) {
      toast.error('Failed to create lobby.')
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        New Lobby
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Lobby</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lobby-name">Lobby name</Label>
            <Input
              id="lobby-name"
              placeholder="e.g. Project Kickoff"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="duration">Meeting duration</Label>
            <select
              id="duration"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="90">1.5 hours</option>
              <option value="120">2 hours</option>
            </select>
          </div>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? 'Creating...' : 'Create Lobby'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
