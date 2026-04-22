import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import firestore as admin_firestore
from firebase_functions import https_fn, scheduler_fn

from scheduling.algorithm import find_meeting_slots

SLOT_INTERVAL_MINUTES = 15
REMINDER_TOLERANCE_MINUTES = 20


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


def _refresh_access_token(refresh_token: str) -> str | None:
    """Exchange a Google OAuth refresh token for a new access token."""
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
            return json.loads(resp.read()).get('access_token')
    except Exception:
        return None


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
        display_name = user_data.get('displayName', uid)

        # If no access token but we have a refresh token, get a fresh one immediately.
        if not access_token and refresh_token:
            access_token = _refresh_access_token(refresh_token) or ''
            if access_token:
                client.collection('users').document(uid).update({
                    'googleAccessToken': access_token,
                    'tokenUpdatedAt': datetime.now(timezone.utc),
                })

        if not access_token:
            ignored_members.append(display_name)
            continue

        busy = _fetch_busy_slots(access_token, availability_start, availability_end)

        # Token expired — try refreshing once.
        if busy is None and refresh_token:
            new_token = _refresh_access_token(refresh_token)
            if new_token:
                client.collection('users').document(uid).update({
                    'googleAccessToken': new_token,
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
                'No participants have Google Calendar connected. '
                'Connect Google Calendar in account settings to run scheduling.'
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
            'Some participants were ignored because Google Calendar is not connected: '
            + ', '.join(ignored_members)
        )

    result['coverage'] = {
        'includedCount': len(included_members),
        'ignoredCount': len(ignored_members),
        'includedMembers': included_members,
        'ignoredMembers': ignored_members,
    }

    return result


@https_fn.on_call()
def schedule_meetings(req: https_fn.CallableRequest) -> dict:
    """Compatibility alias that keeps the legacy plural callable name available."""
    return schedule_meeting(req)


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
        'attendees': [{'email': e} for e in attendee_emails],
        'description': '\n'.join(description_lines),
    }
    if meeting_link:
        payload_dict['location'] = meeting_link

    payload = json.dumps(payload_dict).encode('utf-8')

    req = urllib.request.Request(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
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


def _send_resend_email(to_email: str, subject: str, html: str) -> bool:
    """Send an email via Resend API. Returns False when delivery is unavailable/fails."""
    api_key = os.environ.get('RESEND_API_KEY', '').strip()
    from_email = os.environ.get('REMINDER_FROM_EMAIL', '').strip()

    if not api_key or not from_email:
        return False

    payload = json.dumps({
        'from': from_email,
        'to': [to_email],
        'subject': subject,
        'html': html,
    }).encode('utf-8')

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


def _build_reminder_email_html(
    meeting_name: str,
    slot_start: datetime,
    slot_end: datetime,
    reminder_type: str,
    meeting_link: str = '',
) -> str:
    reminder_label = 'in 24 hours' if reminder_type == '24h' else 'in 1 hour'
    start_label = slot_start.strftime('%Y-%m-%d %H:%M UTC')
    end_label = slot_end.strftime('%H:%M UTC')
    join_link_html = ''
    if meeting_link:
        join_link_html = f'<p><strong>Join:</strong> <a href="{meeting_link}">{meeting_link}</a></p>'

    return (
        f'<p>This is a reminder that <strong>{meeting_name}</strong> starts {reminder_label}.</p>'
        f'<p><strong>When:</strong> {start_label} to {end_label}</p>'
        f'{join_link_html}'
        '<p>Open Chronos to view meeting details and join link.</p>'
    )


@scheduler_fn.on_schedule(schedule='every 15 minutes')
def send_meeting_email_reminders(event: scheduler_fn.ScheduledEvent) -> None:
    """Send 24-hour and 1-hour reminder emails based on per-user reminder settings."""
    client = _get_db()
    now_utc = datetime.now(timezone.utc)
    tolerance = timedelta(minutes=REMINDER_TOLERANCE_MINUTES)

    sent_count = 0
    skipped_missing_provider = 0

    meetings = client.collection('meetings').where('status', '==', 'scheduled').stream()

    for meeting_doc in meetings:
        meeting = meeting_doc.to_dict() or {}
        scheduled_slot = meeting.get('scheduledSlot') or {}
        slot_start_raw = scheduled_slot.get('start')
        slot_end_raw = scheduled_slot.get('end')

        if not slot_start_raw or not slot_end_raw:
            continue

        try:
            slot_start = _parse_iso_to_utc(slot_start_raw)
            slot_end = _parse_iso_to_utc(slot_end_raw)
        except ValueError:
            continue

        if slot_start <= now_utc:
            continue

        delta = slot_start - now_utc
        is_due_24h = abs(delta - timedelta(hours=24)) <= tolerance
        is_due_1h = abs(delta - timedelta(hours=1)) <= tolerance
        if not is_due_24h and not is_due_1h:
            continue

        member_uids = meeting.get('memberUids') or []
        if not member_uids:
            continue

        reminders_sent = meeting.get('remindersSent') or {}
        already_sent_24h = set(reminders_sent.get('24h', []))
        already_sent_1h = set(reminders_sent.get('1h', []))

        just_sent_24h: list[str] = []
        just_sent_1h: list[str] = []

        for uid in member_uids:
            user_doc = client.collection('users').document(uid).get()
            if not user_doc.exists:
                continue

            user_data = user_doc.to_dict() or {}
            email = (user_data.get('email') or '').strip()
            settings = user_data.get('settings') or {}

            if not email:
                continue

            should_send_24h = bool(settings.get('emailReminderTwentyFourHours')) and is_due_24h and uid not in already_sent_24h
            should_send_1h = bool(settings.get('emailReminderOneHour')) and is_due_1h and uid not in already_sent_1h

            if should_send_24h:
                subject = f'Reminder: {meeting.get("name", "Meeting")} starts in 24 hours'
                html = _build_reminder_email_html(
                    meeting.get('name', 'Meeting'),
                    slot_start,
                    slot_end,
                    '24h',
                    meeting.get('meetingLink') or '',
                )
                if _send_resend_email(email, subject, html):
                    just_sent_24h.append(uid)
                    sent_count += 1
                else:
                    skipped_missing_provider += 1

            if should_send_1h:
                subject = f'Reminder: {meeting.get("name", "Meeting")} starts in 1 hour'
                html = _build_reminder_email_html(
                    meeting.get('name', 'Meeting'),
                    slot_start,
                    slot_end,
                    '1h',
                    meeting.get('meetingLink') or '',
                )
                if _send_resend_email(email, subject, html):
                    just_sent_1h.append(uid)
                    sent_count += 1
                else:
                    skipped_missing_provider += 1

        updates: dict = {}
        if just_sent_24h:
            updates['remindersSent.24h'] = admin_firestore.ArrayUnion(just_sent_24h)
        if just_sent_1h:
            updates['remindersSent.1h'] = admin_firestore.ArrayUnion(just_sent_1h)
        if updates:
            updates['reminderLastProcessedAt'] = admin_firestore.SERVER_TIMESTAMP
            client.collection('meetings').document(meeting_doc.id).update(updates)

    print(
        'Reminder job finished',
        {
            'jobName': event.job_name,
            'sentCount': sent_count,
            'skippedMissingProvider': skipped_missing_provider,
        },
    )


def _build_booking_confirmation_html(
    meeting_name: str,
    slot_start: datetime,
    slot_end: datetime,
    meeting_link: str = '',
) -> str:
    start_label = slot_start.strftime('%A, %B ') + str(slot_start.day) + slot_start.strftime(', %Y at %H:%M UTC')
    end_label = slot_end.strftime('%H:%M UTC')
    join_html = (
        f'<p><strong>Join link:</strong> <a href="{meeting_link}">{meeting_link}</a></p>'
        if meeting_link else ''
    )
    return (
        f'<p>Your meeting <strong>{meeting_name}</strong> has been booked.</p>'
        f'<p><strong>When:</strong> {start_label} – {end_label}</p>'
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
        display_name: str = (udata.get('displayName') or '').strip() or uid
        user_timezone: str = (udata.get('settings') or {}).get('timezone') or 'UTC'

        if refresh_token:
            new_token = _refresh_access_token(refresh_token)
            if new_token:
                access_token = new_token
                db_client.collection('users').document(uid).update({
                    'googleAccessToken': access_token,
                    'tokenUpdatedAt': datetime.now(timezone.utc),
                })

        if not access_token:
            missing_calendar_members.append(display_name)

        member_data.append({
            'uid': uid,
            'email': email,
            'token': access_token,
            'name': display_name,
            'timezone': user_timezone,
        })

    if missing_calendar_members:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message=(
                'Every meeting participant must connect Google Calendar before booking. '
                'Missing calendar connection: ' + ', '.join(missing_calendar_members)
            ),
        )

    attendee_emails = [m['email'] for m in member_data if m['email']]
    host_entry = next((m for m in member_data if m['uid'] == host_uid), None)
    host_token = host_entry['token'] if host_entry else ''

    if not host_token:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='Host must connect Google Calendar before booking a meeting.',
        )

    if not attendee_emails:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            message='No attendee emails are available for this meeting.',
        )

    # Create the organiser event on the host's calendar (sends Google invites).
    host_event_id = create_event_fn(
        host_token,
        summary,
        slot_start,
        slot_end,
        attendee_emails,
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
    created_event_member_ids: list[str] = [host_uid]
    for member in member_data:
        if member['uid'] == host_uid:
            continue
        eid = create_event_fn(
            member['token'],
            summary,
            slot_start,
            slot_end,
            attendee_emails,
            meeting_link,
            member.get('timezone', 'UTC'),
        )
        if not eid:
            for cleanup_uid in created_event_member_ids:
                cleanup_token = next(
                    (m['token'] for m in member_data if m['uid'] == cleanup_uid),
                    '',
                )
                cleanup_event_id = calendar_event_ids.get(cleanup_uid, '')
                if cleanup_token and cleanup_event_id:
                    _delete_calendar_event(cleanup_token, cleanup_event_id)
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INTERNAL,
                message='Failed to add meeting event to all participant calendars. Meeting was not booked.',
            )
        calendar_event_ids[member['uid']] = eid
        created_event_member_ids.append(member['uid'])

    # Persist the booking in Firestore.
    db_client.collection('meetings').document(meeting_id).update({
        'status': 'scheduled',
        'scheduledSlot': {'start': slot_start, 'end': slot_end},
        'scheduledAt': admin_firestore.SERVER_TIMESTAMP,
        'calendarEventIds': calendar_event_ids,
    })

    # Send booking confirmation emails to all participants.
    try:
        slot_start_dt = datetime.fromisoformat(slot_start)
        slot_end_dt = datetime.fromisoformat(slot_end)
        subject = f'Meeting booked: {summary}'
        html = _build_booking_confirmation_html(summary, slot_start_dt, slot_end_dt, meeting_link)
        for member in member_data:
            if member['email']:
                _send_resend_email(member['email'], subject, html)
    except Exception as e:
        print(f'Booking confirmation email failed: {e}')

    return {
        'success': True,
        'attendeeCount': len(attendee_emails),
    }


@https_fn.on_call()
def book_meeting(req: https_fn.CallableRequest) -> dict:
    return _book_meeting_impl(
        data=req.data,
        auth_uid=req.auth.uid if req.auth else None,
    )


@https_fn.on_call()
def book_meetings(req: https_fn.CallableRequest) -> dict:
    """Compatibility alias that keeps the legacy plural callable name available."""
    return book_meeting(req)


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
        if not access_token and refresh_token:
            access_token = _refresh_access_token(refresh_token) or ''
        if access_token:
            _delete_calendar_event(access_token, event_id)

    # Collect member emails for notifications.
    member_emails: list[str] = []
    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue
        udata = user_doc.to_dict() or {}
        settings = udata.get('settings') or {}
        email = (udata.get('email') or '').strip()
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
            _send_resend_email(email, subject, html)
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
