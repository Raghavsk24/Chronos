import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { signOut, deleteUser } from 'firebase/auth'
import { toast } from 'sonner'
import { X, Settings, LogOut, Trash2 } from 'lucide-react'
import { db, auth } from '@/lib/firebase'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

interface Props {
  open: boolean
  onClose: () => void
}

interface ProfileData {
  company: string
  role: string
  dateOfBirth: string
  state: string
  city: string
}

export default function UserProfilePanel({ open, onClose }: Props) {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  const [profile, setProfile] = useState<ProfileData>({
    company: '', role: '', dateOfBirth: '', state: '', city: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data()
        setProfile({
          company: d.company ?? '',
          role: d.role ?? '',
          dateOfBirth: d.dateOfBirth ?? '',
          state: d.state ?? '',
          city: d.city ?? '',
        })
      }
      setLoading(false)
    })
  }, [open, user])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        company: profile.company.trim() || null,
        role: profile.role.trim() || null,
        dateOfBirth: profile.dateOfBirth || null,
        state: profile.state.trim() || null,
        city: profile.city.trim() || null,
      })
      toast.success('Profile saved.')
    } catch {
      toast.error('Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    navigate('/login')
  }

  const handleDeleteAccount = async () => {
    if (!user || !auth.currentUser) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'users', user.uid))
      await deleteUser(auth.currentUser)
      navigate('/')
    } catch {
      toast.error('Failed to delete account. You may need to sign in again before deleting.')
      setDeleting(false)
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    opts?: { type?: string; readOnly?: boolean; placeholder?: string }
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={opts?.type ?? 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={opts?.readOnly}
        placeholder={opts?.placeholder}
        className={opts?.readOnly ? 'text-muted-foreground bg-muted cursor-not-allowed' : ''}
      />
    </div>
  )

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/20 z-40" />
      )}

      {/* Panel */}
      <div
        ref={panelRef}
        className={`fixed inset-y-0 right-0 w-88 max-w-full bg-background border-l shadow-xl z-50 flex flex-col transition-transform duration-200 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: '22rem' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b shrink-0">
          <div className="flex items-center gap-3">
            {user?.photoURL && (
              <img src={user.photoURL} alt={user.displayName ?? ''} className="w-10 h-10 rounded-full" />
            )}
            <div>
              <p className="font-semibold text-sm leading-tight">{user?.displayName}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading profile...</p>
          ) : (
            <div className="flex flex-col gap-4">
              {field('p-name', 'Name', user?.displayName ?? '', () => {}, { readOnly: true })}
              {field('p-email', 'Email', user?.email ?? '', () => {}, { readOnly: true })}
              {field('p-company', 'Company / Organization', profile.company, (v) => setProfile((p) => ({ ...p, company: v })), { placeholder: 'Acme Corp' })}
              {field('p-role', 'Role', profile.role, (v) => setProfile((p) => ({ ...p, role: v })), { placeholder: 'e.g. Product Manager' })}
              {field('p-dob', 'Date of Birth', profile.dateOfBirth, (v) => setProfile((p) => ({ ...p, dateOfBirth: v })), { type: 'date' })}
              {field('p-state', 'State', profile.state, (v) => setProfile((p) => ({ ...p, state: v })), { placeholder: 'e.g. California' })}
              {field('p-city', 'City', profile.city, (v) => setProfile((p) => ({ ...p, city: v })), { placeholder: 'e.g. San Francisco' })}

              <Button onClick={handleSave} disabled={saving} className="mt-2">
                {saving ? 'Saving...' : 'Save profile'}
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t flex flex-col gap-2 shrink-0">
          <Button
            variant="ghost"
            className="justify-start gap-2"
            onClick={() => { onClose(); navigate('/app/settings') }}
          >
            <Settings className="size-4" />
            Go to Settings
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="size-4" />
            Delete account
          </Button>
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes your account and all your data. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete my account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
