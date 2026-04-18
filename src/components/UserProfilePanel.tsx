interface Props {
  open: boolean
  onClose: () => void
}

export default function UserProfilePanel({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-y-0 right-0 w-80 bg-background border-l shadow-xl z-50 p-6 flex flex-col"
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onClose} className="self-end text-muted-foreground text-sm mb-4">Close</button>
      <p className="text-muted-foreground text-sm">Profile panel coming soon.</p>
    </div>
  )
}
