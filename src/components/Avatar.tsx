import { useState } from 'react'

interface AvatarProps {
  src?: string | null
  name?: string | null
  className?: string
}

export default function Avatar({ src, name, className = 'w-8 h-8 text-xs' }: AvatarProps) {
  const [failed, setFailed] = useState(false)

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name ?? ''}
        className={`rounded-full shrink-0 object-cover ${className}`}
        onError={() => setFailed(true)}
      />
    )
  }

  return (
    <div className={`rounded-full shrink-0 bg-primary flex items-center justify-center text-primary-foreground font-semibold ${className}`}>
      {name?.[0]?.toUpperCase() ?? '?'}
    </div>
  )
}
