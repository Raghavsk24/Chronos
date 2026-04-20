import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { deleteUser, reauthenticateWithPopup } from 'firebase/auth'
import { toast } from 'sonner'
import { X, Settings, Trash2 } from 'lucide-react'
import { db, auth, googleProvider } from '@/lib/firebase'
import Avatar from '@/components/Avatar'
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

const SENSITIVE_REAUTH_MAX_AGE_MINUTES = 30

export default function UserProfilePanel({ open, onClose }: Props) {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)
  const persistedProfileRef = useRef<ProfileData>({
    company: '',
    role: '',
    dateOfBirth: '',
    state: '',
    city: '',
  })

  const [profile, setProfile] = useState<ProfileData>({
    company: '', role: '', dateOfBirth: '', state: '', city: '',
  })
  const [dobLocked, setDobLocked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [requiresRecentReauth, setRequiresRecentReauth] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setLoading(true)

    const currentUser = auth.currentUser ?? user
    const lastSignInRaw = currentUser.metadata.lastSignInTime
    const lastSignInDate = lastSignInRaw ? new Date(lastSignInRaw) : null
    if (!lastSignInDate || Number.isNaN(lastSignInDate.getTime())) {
      setRequiresRecentReauth(true)
    } else {
      const ageMs = Date.now() - lastSignInDate.getTime()
      setRequiresRecentReauth(ageMs > SENSITIVE_REAUTH_MAX_AGE_MINUTES * 60 * 1000)
    }

    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      if (snap.exists()) {
        const d = snap.data()
        const dob = d.dateOfBirth ?? ''
        const fetchedProfile = {
          company: d.company ?? '',
          role: d.role ?? '',
          dateOfBirth: dob,
          state: d.state ?? '',
          city: d.city ?? '',
        }
        setProfile(fetchedProfile)
        persistedProfileRef.current = fetchedProfile
        setDobLocked(!!dob)
      }
      setLoading(false)
    })
  }, [open, user])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleSave = async () => {
    if (!user) return
    const previousProfile = persistedProfileRef.current
    const optimisticProfile: ProfileData = {
      company: profile.company.trim(),
      role: profile.role.trim(),
      dateOfBirth: dobLocked ? previousProfile.dateOfBirth : (profile.dateOfBirth || ''),
      state: profile.state.trim(),
      city: profile.city.trim(),
    }

    setProfile(optimisticProfile)
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        company: optimisticProfile.company || null,
        role: optimisticProfile.role || null,
        ...(dobLocked ? {} : { dateOfBirth: optimisticProfile.dateOfBirth || null }),
        state: optimisticProfile.state || null,
        city: optimisticProfile.city || null,
      })
      persistedProfileRef.current = optimisticProfile
      toast.success('Profile saved.')
    } catch {
      setProfile(previousProfile)
      toast.error('Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!user || !auth.currentUser) return
    setDeleting(true)
    try {
      await reauthenticateWithPopup(auth.currentUser, googleProvider)
      await deleteDoc(doc(db, 'users', user.uid))
      await deleteUser(auth.currentUser)
      navigate('/')
    } catch {
      toast.error('Failed to delete account. Please try again.')
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
      {open && <div className="fixed inset-0 bg-black/20 z-40" />}

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
            <Avatar src={user?.photoURL} name={user?.displayName} className="w-10 h-10 text-sm" />
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
              {field('p-company', 'Company / Organization', profile.company, (v) => setProfile((p) => ({ ...p, company: v })))}
              {field('p-role', 'Role', profile.role, (v) => setProfile((p) => ({ ...p, role: v })))}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="p-dob">Date of Birth</Label>
                <Input
                  id="p-dob"
                  type="date"
                  value={profile.dateOfBirth}
                  onChange={(e) => !dobLocked && setProfile((p) => ({ ...p, dateOfBirth: e.target.value }))}
                  readOnly={dobLocked}
                  className={dobLocked ? 'text-muted-foreground bg-muted cursor-not-allowed' : ''}
                />
              </div>
              {field('p-state', 'State', profile.state, (v) => setProfile((p) => ({ ...p, state: v })))}
              {field('p-city', 'City', profile.city, (v) => setProfile((p) => ({ ...p, city: v })))}

              <Button onClick={handleSave} disabled={saving} className="mt-2">
                {saving ? 'Saving...' : 'Save profile'}
              </Button>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-5 border-t flex flex-col gap-2 shrink-0">
          {requiresRecentReauth && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-900 font-medium">Re-authentication required for sensitive actions</p>
              <p className="text-xs text-amber-800 mt-0.5">
                Your session is older than {SENSITIVE_REAUTH_MAX_AGE_MINUTES} minutes. Re-authenticate in Settings before deleting your account.
              </p>
            </div>
          )}
          <Button variant="ghost" className="justify-start gap-2" onClick={() => { onClose(); navigate('/app/settings') }}>
            <Settings className="size-4" />
            Go to Settings
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={requiresRecentReauth}
          >
            <Trash2 className="size-4" />
            Delete account
          </Button>
        </div>
      </div>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete account?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes your account and all your data. This cannot be undone. You'll be asked to confirm with Google.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete my account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
