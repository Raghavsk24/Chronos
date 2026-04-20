interface Props {
  height?: number
  className?: string
}

export default function ChronosLogo({ height = 30, className = '' }: Props) {
  return (
    <img
      src="/chronos-logo.png"
      alt="Chronos"
      height={height}
      style={{ height, width: 'auto', objectFit: 'contain' }}
      className={`select-none ${className}`}
    />
  )
}
