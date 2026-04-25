import { httpsCallable } from 'firebase/functions'
import { functions } from '@/lib/firebase'

const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

function openOAuthPopup(clientId: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: CALENDAR_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    })

    const left = window.screenX + (window.outerWidth - 500) / 2
    const top = window.screenY + (window.outerHeight - 600) / 2
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'google-calendar-auth',
      `width=500,height=600,left=${left},top=${top}`
    )

    if (!popup) {
      reject(new Error('Popup was blocked. Allow popups for this site and try again.'))
      return
    }

    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'GOOGLE_CALENDAR_AUTH') return
      window.removeEventListener('message', handler)
      if (event.data.error) {
        reject(new Error(event.data.error === 'access_denied' ? 'Calendar access was denied.' : event.data.error))
      } else if (event.data.code) {
        resolve(event.data.code as string)
      } else {
        reject(new Error('No authorization code received.'))
      }
    }

    window.addEventListener('message', handler)

    // Clean up listener if popup is closed without completing the flow
    const pollClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollClosed)
        window.removeEventListener('message', handler)
        reject(new Error('Popup closed before completing authorization.'))
      }
    }, 500)
  })
}

export async function connectGoogleCalendar(): Promise<void> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string
  if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID is not configured.')

  const redirectUri = `${window.location.origin}/auth/google/callback`
  const code = await openOAuthPopup(clientId, redirectUri)

  const connectFn = httpsCallable(functions, 'connect_google_calendar')
  await connectFn({ code, redirectUri })
}
