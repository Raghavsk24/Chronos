import { useEffect } from 'react'

export default function GoogleCalendarCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const error = params.get('error')

    if (window.opener) {
      window.opener.postMessage(
        { type: 'GOOGLE_CALENDAR_AUTH', code, error },
        window.location.origin
      )
      window.close()
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Connecting Google Calendar...</p>
    </div>
  )
}
