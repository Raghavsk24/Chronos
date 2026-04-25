import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import firebase_admin
import sentry_sdk
from firebase_admin import firestore as admin_firestore
from firebase_functions import https_fn

from scheduling.algorithm import find_meeting_slots

_sentry_dsn = os.environ.get('SENTRY_DSN', '')
if _sentry_dsn:
    sentry_sdk.init(
        dsn=_sentry_dsn,
        traces_sample_rate=0.1,
        environment=os.environ.get('SENTRY_ENVIRONMENT', 'production'),
    )

SLOT_INTERVAL_MINUTES = 15

if not firebase_admin._apps:
    firebase_admin.initialize_app()


def _parse_iso_to_utc(iso_str: str) -> datetime:
    """Parse an ISO datetime string and normalize it to UTC-aware datetime."""
    dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def _get_db():
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return admin_firestore.client()


def _to_naive_utc(iso_str: str) -> str:
    """Convert an ISO 8601 string (with or without timezone) to a naive UTC ISO string."""
    dt = datetime.fromisoformat(iso_str)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


def _timezone_for_name(timezone_name: str | None):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    tz_name = (timezone_name or 'UTC').strip() or 'UTC'
    if tz_name in {'UTC', 'Etc/UTC', 'GMT'}:
        return timezone.utc, 'UTC'

    try:
        return ZoneInfo(tz_name), tz_name
    except ZoneInfoNotFoundError:
        return timezone.utc, 'UTC'


def _utc_iso_to_timezone_iso(iso_str: str, timezone_name: str | None) -> tuple[str, str]:
    utc_dt = _parse_iso_to_utc(iso_str)
    tz, normalized_tz_name = _timezone_for_name(timezone_name)
    local_dt = utc_dt.astimezone(tz)
    return local_dt.isoformat(), normalized_tz_name


def _round_up_to_interval(dt: datetime, minutes: int) -> datetime:
    seconds_into_hour = dt.minute * 60 + dt.second
    interval_seconds = minutes * 60
    remainder = seconds_into_hour % interval_seconds
    if remainder == 0 and dt.microsecond == 0:
        return dt.replace(second=0, microsecond=0)

    add_seconds = interval_seconds - remainder
    if dt.microsecond:
        add_seconds -= 1
    rounded = dt + timedelta(seconds=add_seconds)
    return rounded.replace(second=0, microsecond=0)


def _add_one_month(dt: datetime) -> datetime:
    year = dt.year
    month = dt.month + 1
    if month == 13:
        month = 1
        year += 1

    if month == 2:
        leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
        max_day = 29 if leap else 28
    elif month in (4, 6, 9, 11):
        max_day = 30
    else:
        max_day = 31

    day = min(dt.day, max_day)
    return dt.replace(year=year, month=month, day=day)


class _InvalidGrantError(Exception):
    """Raised when Google rejects a refresh token as permanently invalid (revoked/expired)."""


def _refresh_access_token(refresh_token: str) -> tuple[str, int] | None:
    """Exchange a Google OAuth refresh token for a new access token.

    Returns (access_token, expires_in_seconds) on success, None on transient failure.
    Raises _InvalidGrantError when Google returns invalid_grant (token permanently revoked).
    """
    client_id = os.environ.get('GOOGLE_CLIENT_ID', '')
    client_secret = os.environ.get('GOOGLE_CLIENT_SECRET', '')
    if not client_id or not client_secret or not refresh_token:
        return None

    payload = urllib.parse.urlencode({
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh_token,
        'grant_type': 'refresh_token',
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://oauth2.googleapis.com/token',
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            token = data.get('access_token')
            if not token:
                return None
            return (token, int(data.get('expires_in', 3600)))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
        except Exception:
            body = {}
        if body.get('error') == 'invalid_grant':
            raise _InvalidGrantError()
        return None
    except Exception:
        return None


def _resolve_access_token(
    client,
    uid: str,
    access_token: str,
    refresh_token: str,
    token_expires_at=None,
) -> str:
    """Return a fresh access token, refreshing proactively when near expiry.

    Skips the network call entirely when the stored token has more than 5 minutes
    of remaining validity. Falls back to the existing token if the refresh request
    fails (e.g. transient network error) so callers can still attempt the API call.
    """
    if not refresh_token:
        return access_token

    # Skip the refresh network call if the token is comfortably valid (>5 min left).
    if access_token and token_expires_at is not None:
        now = datetime.now(timezone.utc)
        # Handle Firestore Timestamp objects
        if hasattr(token_expires_at, 'to_pydatetime'):
            expires = token_expires_at.to_pydatetime()
        elif isinstance(token_expires_at, datetime):
            expires = token_expires_at
        else:
            expires = None
        
        if expires is not None:
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if (expires - now).total_seconds() > 300:
                return access_token

    # Let _InvalidGrantError propagate — callers must catch and set calendarDisconnected.
    result = _refresh_access_token(refresh_token)
    if not result:
        return access_token

    new_token, expires_in = result
    new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    if new_token != access_token:
        client.collection('users').document(uid).update({
            'googleAccessToken': new_token,
            'tokenExpiresAt': new_expires_at,
            'tokenUpdatedAt': datetime.now(timezone.utc),
        })

    return new_token


def _fetch_busy_slots(access_token: str, search_start: datetime, search_end: datetime) -> list[dict] | None:
    """Call the Google Calendar FreeBusy API for a user's primary calendar.

    Returns a list of {'start': str, 'end': str} dicts on success,
    or None if the token is expired / invalid.
    """
    time_min = search_start.replace(tzinfo=timezone.utc).isoformat()
    time_max = search_end.replace(tzinfo=timezone.utc).isoformat()

    payload = json.dumps({
        'timeMin': time_min,
        'timeMax': time_max,
        'items': [{'id': 'primary'}],
    }).encode('utf-8')

    req = urllib.request.Request(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        data=payload,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            busy_raw = data.get('calendars', {}).get('primary', {}).get('busy', [])
            return [
                {
                    'start': _to_naive_utc(b['start']),
                    'end':   _to_naive_utc(b['end']),
                }
                for b in busy_raw
            ]
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return None  # Token expired
        return []
    except Exception:
        return []


@https_fn.on_call()
def schedule_meeting(req: https_fn.CallableRequest) -> dict:
    """
    Callable Cloud Function that runs the scheduling algorithm for a meeting.

    Expected input:
        { "meetingId": "<Firestore meeting document ID>" }

    Flow:
        1. Verify the caller is signed in.
        2. Fetch the meeting document for memberUids, duration, and preferences.
        3. Fetch each member's settings + Google Calendar busy slots.
        4. Run the scheduling algorithm (passing preferences).
        5. Return { slots: [...] } or { error: "..." }.
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in to schedule a meeting.',
        )

    meeting_id: str = req.data.get('meetingId', '').strip()
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='meetingId is required.',
        )

    client = _get_db()
    now_utc = datetime.utcnow()
    availability_start = _round_up_to_interval(now_utc + timedelta(hours=1), SLOT_INTERVAL_MINUTES)
    availability_end = _add_one_month(now_utc)

    # --- 1. Fetch meeting ---
    meeting_doc = client.collection('meetings').document(meeting_id).get()
    if not meeting_doc.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Meeting not found.',
        )

    meeting = meeting_doc.to_dict()
    member_uids: list[str] = meeting.get('memberUids') or []
    member_records: list[dict] = meeting.get('members') or []
    meeting_duration: int = meeting.get('duration', 60)
    preferences: dict = meeting.get('preferences') or {}

    if not member_uids and member_records:
        member_uids = [m.get('uid') for m in member_records if m.get('uid')]

    if not member_uids:
        return {'error': 'Meeting has no participants.'}

    # --- 2. Fetch each member's settings and calendar busy slots ---
    busy_slots_by_participant: dict = {}
    buffer_by_participant: dict = {}
    work_hours_by_participant: dict = {}
    work_days_by_participant: dict = {}
    included_members: list[str] = []
    ignored_members: list[str] = []

    allowed_uids = set(member_uids)

    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue

        user_data: dict = user_doc.to_dict() or {}
        settings: dict = user_data.get('settings', {})
        access_token: str = user_data.get('googleAccessToken', '')
        refresh_token: str = user_data.get('googleRefreshToken', '')
        token_expires_at = user_data.get('tokenExpiresAt')
        display_name = user_data.get('displayName', uid)

        try:
            access_token = _resolve_access_token(client, uid, access_token, refresh_token, token_expires_at)
        except _InvalidGrantError:
            client.collection('users').document(uid).update({'calendarDisconnected': True})
            ignored_members.append(display_name)
            continue

        if not access_token:
            ignored_members.append(display_name)
            continue

        busy = _fetch_busy_slots(access_token, availability_start, availability_end)

        # Token was rejected despite proactive refresh — one last forced retry.
        if busy is None and refresh_token:
            try:
                retry = _refresh_access_token(refresh_token)
            except _InvalidGrantError:
                client.collection('users').document(uid).update({'calendarDisconnected': True})
                ignored_members.append(display_name)
                continue
            if retry:
                new_token, expires_in = retry
                new_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
                client.collection('users').document(uid).update({
                    'googleAccessToken': new_token,
                    'tokenExpiresAt': new_expires_at,
                    'tokenUpdatedAt': datetime.now(timezone.utc),
                })
                busy = _fetch_busy_slots(new_token, availability_start, availability_end)

        if busy is None:
            ignored_members.append(display_name)
            continue

        busy_slots_by_participant[uid] = busy
        buffer_by_participant[uid] = settings.get('bufferMinutes', 15)
        work_hours_by_participant[uid] = {
            'start_hour':   settings.get('workStartHour', 9),
            'start_minute': settings.get('workStartMinute', 0),
            'end_hour':     settings.get('workEndHour', 17),
            'end_minute':   settings.get('workEndMinute', 0),
            'timezone':     settings.get('timezone') or 'UTC',
        }
        work_days_by_participant[uid] = settings.get('workDays', [0, 1, 2, 3, 4])
        included_members.append(display_name)

    if not work_days_by_participant:
        return {
            'error': (
                'No participant calendars are currently accessible. '
                'Reconnect Google Calendar in account settings to run scheduling.'
            ),
            'coverage': {
                'includedCount': 0,
                'ignoredCount': len(ignored_members),
                'includedMembers': [],
                'ignoredMembers': ignored_members,
            },
        }

    # --- 3. Run the scheduling algorithm ---
    print(f'DEBUG participants included ({len(included_members)}): {included_members}')
    print(f'DEBUG participants ignored  ({len(ignored_members)}): {ignored_members}')
    for uid in work_hours_by_participant:
        wh = work_hours_by_participant[uid]
        wd = work_days_by_participant[uid]
        bc = len(busy_slots_by_participant.get(uid, []))
        print(f'DEBUG [{uid}] timezone={wh.get("timezone")} hours={wh["start_hour"]}:{wh["start_minute"]:02d}-{wh["end_hour"]}:{wh["end_minute"]:02d} work_days={wd} busy_slots={bc}')
    print(f'DEBUG preferences: {preferences}')
    # Keep only participants that are in this meeting and have valid settings + connected calendars.
    filtered_busy = {uid: slots for uid, slots in busy_slots_by_participant.items() if uid in allowed_uids}
    filtered_work_hours = {uid: wh for uid, wh in work_hours_by_participant.items() if uid in allowed_uids}
    filtered_work_days = {uid: wd for uid, wd in work_days_by_participant.items() if uid in allowed_uids}

    result = find_meeting_slots(
        busy_slots_by_participant=filtered_busy,
        buffer_by_participant=buffer_by_participant,
        work_hours_by_participant=filtered_work_hours,
        work_days_by_participant=filtered_work_days,
        meeting_duration_minutes=meeting_duration,
        search_start=now_utc,
        preferences=preferences,
    )

    if ignored_members and 'error' not in result:
        result['warning'] = (
            'Some participants were ignored because their calendar could not be accessed: '
            + ', '.join(ignored_members)
        )

    result['coverage'] = {
        'includedCount': len(included_members),
        'ignoredCount': len(ignored_members),
        'includedMembers': included_members,
        'ignoredMembers': ignored_members,
    }

    return result



def _create_calendar_event(
    access_token: str,
    summary: str,
    start_iso: str,
    end_iso: str,
    attendee_emails: list[str],
    meeting_link: str = '',
    time_zone: str = 'UTC',
) -> str:
    """Create a Google Calendar event. Returns the event ID on success, '' on failure."""
    start_dt, normalized_time_zone = _utc_iso_to_timezone_iso(start_iso, time_zone)
    end_dt, _ = _utc_iso_to_timezone_iso(end_iso, time_zone)

    description_lines = [summary]
    if meeting_link:
        description_lines.append(f'Join link: {meeting_link}')

    payload_dict = {
        'summary': summary,
        'start': {'dateTime': start_dt, 'timeZone': normalized_time_zone},
        'end':   {'dateTime': end_dt,   'timeZone': normalized_time_zone},
        'description': '\n'.join(description_lines),
    }
    if attendee_emails:
        payload_dict['attendees'] = [{'email': e} for e in attendee_emails]
    if meeting_link:
        payload_dict['location'] = meeting_link

    payload = json.dumps(payload_dict).encode('utf-8')

    req = urllib.request.Request(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
        data=payload,
        headers={
            'Authorization': f'Bearer {access_token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read()).get('id', '')
    except urllib.error.HTTPError as e:
        print(f'Calendar API error {e.code}: {e.read().decode()}')
        return ''
    except Exception as e:
        print(f'Calendar event creation failed: {e}')
        return ''


def _delete_calendar_event(access_token: str, event_id: str) -> bool:
    """Delete a Google Calendar event by ID. Returns True if deleted or already gone."""
    url = (
        'https://www.googleapis.com/calendar/v3/calendars/primary/events/'
        + urllib.parse.quote(event_id, safe='')
        + '?sendUpdates=all'
    )
    req = urllib.request.Request(
        url,
        headers={'Authorization': f'Bearer {access_token}'},
        method='DELETE',
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 204
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return True  # already removed
        print(f'Calendar delete error {e.code}: {e.read().decode()}')
        return False
    except Exception as e:
        print(f'Calendar event deletion failed: {e}')
        return False


        return False

    except Exception as e:
        print(f'Calendar event deletion failed: {e}')
        return False


def _send_resend_email(to_email: str, subject: str, html: str, reply_to: str | None = None) -> bool:
    """Send an email via Resend API. Returns False when delivery is unavailable/fails."""
    api_key = os.environ.get('RESEND_API_KEY', '').strip()
    from_email = os.environ.get('REMINDER_FROM_EMAIL', '').strip()

    if not api_key or not from_email:
        return False

    payload_dict = {
        'from': from_email,
        'to': [to_email],
        'subject': subject,
        'html': html,
    }
    if reply_to:
        payload_dict['reply_to'] = [reply_to]

    payload = json.dumps(payload_dict).encode('utf-8')

    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=payload,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 300
    except Exception as e:
        print(f'Reminder email send failed for {to_email}: {e}')
        return False



def _build_booking_confirmation_html(
    meeting_name: str,
    slot_start: datetime,
    slot_end: datetime,
    meeting_link: str = '',
    participant_names: list[str] | None = None,
    role: str = 'participant',
) -> str:
    start_label = slot_start.strftime('%A, %B ') + str(slot_start.day) + slot_start.strftime(', %Y at %H:%M UTC')
    end_label = slot_end.strftime('%H:%M UTC')
    join_html = (
        f'<p><strong>Join link:</strong> <a href="{meeting_link}">{meeting_link}</a></p>'
        if meeting_link else ''
    )
    if role == 'host':
        intro = f'<p>You have booked <strong>{meeting_name}</strong>. Invites have been sent to all participants.</p>'
    else:
        intro = f"<p>You've been invited to <strong>{meeting_name}</strong>.</p>"
    participants_html = ''
    if participant_names:
        names_li = ''.join(f'<li>{name}</li>' for name in participant_names)
        participants_html = f'<p><strong>Participants:</strong></p><ul>{names_li}</ul>'
    return (
        f'{intro}'
        f'<p><strong>When:</strong> {start_label} – {end_label}</p>'
        f'{participants_html}'
        f'{join_html}'
        '<p>You will receive reminders 24 hours and 1 hour before the meeting.</p>'
    )


def _book_meeting_impl(
    data: dict,
    auth_uid: str | None,
    client=None,
    create_event_fn=_create_calendar_event,
) -> dict:
    if auth_uid is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in to book a meeting.',
        )

    meeting_id: str = (data.get('meetingId') or '').strip()
    slot_start: str = (data.get('slotStart') or '').strip()
    slot_end: str = (data.get('slotEnd') or '').strip()

    if not meeting_id or not slot_start or not slot_end:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='meetingId, slotStart, and slotEnd are required.',
        )

    db_client = client or _get_db()

    meeting_doc = db_client.collection('meetings').document(meeting_id).get()
    if not meeting_doc.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Meeting not found.',
        )

    meeting = meeting_doc.to_dict() or {}

    if auth_uid != meeting.get('hostUid'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='Only the host can book the meeting.',
        )

    member_uids: list[str] = meeting.get('memberUids', [])
    summary = meeting.get('name', 'Meeting')
    meeting_link = (meeting.get('meetingLink') or '').strip()
    host_uid: str = meeting.get('hostUid', '')

    # Collect each member's email and refreshed access token in one pass.
    member_data: list[dict] = []
    missing_calendar_members: list[str] = []
    for uid in member_uids:
        user_doc = db_client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        udata = user_doc.to_dict() or {}
        email: str = (udata.get('email') or '').strip()
        access_token: str = udata.get('googleAccessToken', '')
        refresh_token: str = udata.get('googleRefreshToken', '')
        token_expires_at = udata.get('tokenExpiresAt')
        display_name: str = (udata.get('displayName') or '').strip() or uid
        user_timezone: str = (udata.get('settings') or {}).get('timezone') or 'UTC'

        access_token = _resolve_access_token(db_client, uid, access_token, refresh_token, token_expires_at)

        if not access_token:
            missing_calendar_members.append(display_name)

        member_data.append({
            'uid': uid,
            'email': email,
            'token': access_token,
            'refresh_token': refresh_token,
            'name': display_name,
            'timezone': user_timezone,
        })

    if missing_calendar_members:
        print(f'Participants without calendar access (will be skipped): {", ".join(missing_calendar_members)}')

    host_entry = next((m for m in member_data if m['uid'] == host_uid), None)
    host_token = host_entry['token'] if host_entry else ''
    host_email = (host_entry.get('email') or '').strip() if host_entry else ''

    if not host_token:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='Host must connect Google Calendar before booking a meeting.',
        )

    # Create the host event without Google attendee emails.
    # Chronos sends the booking confirmation email instead.
    host_event_id = create_event_fn(
        host_token,
        summary,
        slot_start,
        slot_end,
        [],
        meeting_link,
        host_entry.get('timezone', 'UTC') if host_entry else 'UTC',
    )
    if not host_event_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='Failed to create calendar invite event. Meeting was not booked.',
        )

    # Also add the event directly to each participant's own calendar.
    # Store each event ID so we can delete them later on reschedule/cancel.
    calendar_event_ids: dict[str, str] = {host_uid: host_event_id}
    ignored_participants: list[str] = []
    for member in member_data:
        if member['uid'] == host_uid:
            continue
        token = member['token']
        if not token:
            ignored_participants.append(member['name'])
            continue
        eid = create_event_fn(token, summary, slot_start, slot_end, [], meeting_link, member.get('timezone', 'UTC'))
        if not eid:
            # One retry with a fresh token before giving up.
            fresh = _refresh_access_token(member.get('refresh_token', ''))
            if fresh:
                new_token, _ = fresh
                eid = create_event_fn(new_token, summary, slot_start, slot_end, [], meeting_link, member.get('timezone', 'UTC'))
                if eid:
                    db_client.collection('users').document(member['uid']).update({'googleAccessToken': new_token})
        if not eid:
            ignored_participants.append(member['name'])
            print(f'Skipping calendar event for participant {member["name"]}: event creation failed.')
            continue
        calendar_event_ids[member['uid']] = eid

    if ignored_participants:
        print(f'Calendar event skipped for {len(ignored_participants)} participant(s): {", ".join(ignored_participants)}')

    # Persist the booking in Firestore.
    db_client.collection('meetings').document(meeting_id).update({
        'status': 'scheduled',
        'scheduledSlot': {'start': slot_start, 'end': slot_end},
        'scheduledAt': admin_firestore.SERVER_TIMESTAMP,
        'calendarEventIds': calendar_event_ids,
    })

    # Send booking confirmation to host and invite emails to all participants.
    try:
        slot_start_dt = datetime.fromisoformat(slot_start)
        slot_end_dt = datetime.fromisoformat(slot_end)
        all_names = [m['name'] for m in member_data if m['name']]

        participant_html = _build_booking_confirmation_html(
            summary, slot_start_dt, slot_end_dt, meeting_link,
            participant_names=all_names, role='participant',
        )
        for member in member_data:
            if member['uid'] == host_uid:
                continue
            if member['email']:
                _send_resend_email(
                    member['email'],
                    f"You're invited: {summary}",
                    participant_html,
                    reply_to=host_email or None,
                )

        host_html = _build_booking_confirmation_html(
            summary, slot_start_dt, slot_end_dt, meeting_link,
            participant_names=all_names, role='host',
        )
        if host_email:
            _send_resend_email(host_email, f'Meeting booked: {summary}', host_html)
    except Exception as e:
        print(f'Booking confirmation email failed: {e}')

    return {
        'success': True,
        'attendeeCount': len([m for m in member_data if m['uid'] != host_uid and m['email']]),
    }


@https_fn.on_call()
def book_meeting(req: https_fn.CallableRequest) -> dict:
    return _book_meeting_impl(
        data=req.data,
        auth_uid=req.auth.uid if req.auth else None,
    )



@https_fn.on_call()
def cancel_booking(req: https_fn.CallableRequest) -> dict:
    """
    Removes calendar events from all participants and optionally sends emails.

    Expected input:
        { "meetingId": "...", "action": "rebook" | "cancel" }

    action='rebook'  → deletes calendar events, emails participants that a new
                       time will be chosen, resets meeting to 'scheduling'.
    action='cancel'  → deletes calendar events, emails a cancellation notice,
                       deletes the meeting document.
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in.',
        )

    meeting_id: str = (req.data.get('meetingId') or '').strip()
    action: str = (req.data.get('action') or '').strip()

    if not meeting_id or action not in ('rebook', 'cancel'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='meetingId and action ("rebook" or "cancel") are required.',
        )

    client = _get_db()
    meeting_doc = client.collection('meetings').document(meeting_id).get()
    if not meeting_doc.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Meeting not found.',
        )

    meeting = meeting_doc.to_dict() or {}
    if req.auth.uid != meeting.get('hostUid'):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.PERMISSION_DENIED,
            message='Only the host can cancel or rebook a meeting.',
        )

    summary = meeting.get('name', 'Meeting')
    meeting_link = (meeting.get('meetingLink') or '').strip()
    member_uids: list[str] = meeting.get('memberUids', [])
    host_uid = meeting.get('hostUid', '')
    calendar_event_ids: dict = meeting.get('calendarEventIds') or {}

    # Delete the calendar event from every participant's calendar.
    for uid, event_id in calendar_event_ids.items():
        if not event_id:
            continue
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        udata = user_doc.to_dict() or {}
        access_token: str = udata.get('googleAccessToken', '')
        refresh_token: str = udata.get('googleRefreshToken', '')
        token_expires_at = udata.get('tokenExpiresAt')
        access_token = _resolve_access_token(client, uid, access_token, refresh_token, token_expires_at)
        if access_token:
            _delete_calendar_event(access_token, event_id)

    # Collect member emails for notifications.
    host_email: str = ''
    member_emails: list[str] = []
    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        udata = user_doc.to_dict() or {}
        settings = udata.get('settings') or {}
        email = (udata.get('email') or '').strip()
        if uid == host_uid:
            host_email = email
            continue
        if not email:
            continue
        if action == 'cancel' and not settings.get('notifyMeetingCancelled', True):
            continue
        member_emails.append(email)

    # Send notification emails.
    try:
        if action == 'rebook':
            subject = f'Meeting rescheduled: {summary}'
            html = (
                f'<p>The meeting <strong>{summary}</strong> is being rescheduled.</p>'
                f'<p>The host is selecting a new time. You will receive a confirmation once booked.</p>'
                + (f'<p><strong>Join link:</strong> <a href="{meeting_link}">{meeting_link}</a></p>' if meeting_link else '')
            )
        else:
            subject = f'Meeting cancelled: {summary}'
            html = f'<p>The meeting <strong>{summary}</strong> has been cancelled.</p>'

        for email in member_emails:
            _send_resend_email(email, subject, html, reply_to=host_email or None)
    except Exception as e:
        print(f'Cancel/rebook notification email failed: {e}')

    # Update or delete the Firestore meeting document.
    if action == 'rebook':
        client.collection('meetings').document(meeting_id).update({
            'status': 'scheduling',
            'scheduledSlot': None,
            'calendarEventIds': {},
        })
    else:
        client.collection('meetings').document(meeting_id).delete()

    return {'success': True}



@https_fn.on_call()
def refresh_meeting_tokens(req: https_fn.CallableRequest) -> dict:
    """Return calendar connection status for all meeting participants.

    Reads Firestore only — no Google API calls. A participant is connected when
    they have a googleRefreshToken stored and calendarDisconnected is not True.
    The actual token refresh happens lazily inside schedule_meeting.
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in.',
        )

    meeting_id = (req.data.get('meetingId') or '').strip()
    if not meeting_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='meetingId is required.',
        )

    client = _get_db()
    meeting_doc = client.collection('meetings').document(meeting_id).get()
    if not meeting_doc.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Meeting not found.',
        )

    member_uids: list[str] = (meeting_doc.to_dict() or {}).get('memberUids') or []
    connection_status: dict[str, bool] = {}

    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            connection_status[uid] = False
            continue
        udata = user_doc.to_dict() or {}
        has_refresh_token = bool(udata.get('googleRefreshToken'))
        is_disconnected = bool(udata.get('calendarDisconnected'))
        connection_status[uid] = has_refresh_token and not is_disconnected

    return {'connectionStatus': connection_status}


@https_fn.on_call()
def connect_google_calendar(req: https_fn.CallableRequest) -> dict:
    """Exchange a Google OAuth authorization code for tokens and store them in Firestore.

    The frontend obtains the authorization code via the OAuth popup flow and passes
    it here. The backend exchanges it server-side (keeping client_secret off the browser)
    and stores the resulting access_token and refresh_token. This guarantees a valid
    refresh_token is always stored, unlike the signInWithPopup approach.
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in.',
        )

    code: str = (req.data.get('code') or '').strip()
    redirect_uri: str = (req.data.get('redirectUri') or '').strip()

    if not code or not redirect_uri:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='code and redirectUri are required.',
        )

    client_id = os.environ.get('GOOGLE_CLIENT_ID', '')
    client_secret = os.environ.get('GOOGLE_CLIENT_SECRET', '')
    if not client_id or not client_secret:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='Server configuration error.',
        )

    payload = urllib.parse.urlencode({
        'code': code,
        'client_id': client_id,
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    }).encode('utf-8')

    token_req = urllib.request.Request(
        'https://oauth2.googleapis.com/token',
        data=payload,
        headers={'Content-Type': 'application/x-www-form-urlencoded'},
        method='POST',
    )

    try:
        with urllib.request.urlopen(token_req, timeout=10) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
        except Exception:
            body = {}
        print(f'connect_google_calendar token exchange failed: {e.code} {body}')
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='Failed to exchange authorization code. Please try again.',
        )
    except Exception as e:
        print(f'connect_google_calendar token exchange error: {e}')
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='Token exchange failed.',
        )

    access_token = data.get('access_token', '')
    refresh_token = data.get('refresh_token', '')
    expires_in = int(data.get('expires_in', 3600))

    if not access_token:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message='No access token returned from Google.',
        )

    db_client = _get_db()
    update: dict = {
        'googleAccessToken': access_token,
        'tokenExpiresAt': datetime.now(timezone.utc) + timedelta(seconds=expires_in),
        'tokenUpdatedAt': datetime.now(timezone.utc),
        'calendarDisconnected': False,
    }
    if refresh_token:
        update['googleRefreshToken'] = refresh_token

    db_client.collection('users').document(req.auth.uid).set(update, merge=True)
    return {'success': True}
