export async function fetchCalendarTimezone(accessToken: string): Promise<string> {
  try {
    const resp = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/settings/timezone',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!resp.ok) return ''
    const data = await resp.json()
    return data.value ?? ''
  } catch {
    return ''
  }
}
