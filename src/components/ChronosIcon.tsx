interface Props {
  className?: string
  size?: number
}

export default function ChronosIcon({ className = '', size = 32 }: Props) {
  return (
    <img
      src="/chronos-icon.png"
      alt="Chronos"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  )
}
