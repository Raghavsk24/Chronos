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
    <div className={`rounded-full shrink-0 bg-muted flex items-center justify-center ${className}`}>
      <svg viewBox="0 0 24 24" fill="none" className="w-1/2 h-1/2 text-muted-foreground" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
      </svg>
    </div>
  )
}
