import json
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import firebase_admin
from firebase_admin import firestore as admin_firestore
from firebase_functions import https_fn

from scheduling.algorithm import find_meeting_slots

MAX_WEEKS = 4


def _get_db():
    # Initialize on first actual invocation, not at import time.
    # Calling initialize_app() at module level causes a timeout during
    # Firebase's local introspection phase because it tries to reach the
    # GCP metadata server, which doesn't exist outside of GCP.
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return admin_firestore.client()


def _to_naive_utc(iso_str: str) -> str:
    """Convert an ISO 8601 string (with or without timezone) to a naive UTC ISO string.

    The scheduling algorithm uses naive datetimes, so timezone info must be
    stripped. We normalise to UTC first so the comparison is consistent.
    """
    dt = datetime.fromisoformat(iso_str)
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.isoformat()


def _fetch_busy_slots(access_token: str, search_start: datetime) -> list[dict] | None:
    """Call the Google Calendar FreeBusy API for a user's primary calendar.

    Returns a list of {'start': str, 'end': str} dicts on success,
    or None if the token is expired / invalid (caller should ask user to re-login).
    """
    time_min = search_start.replace(tzinfo=timezone.utc).isoformat()
    time_max = (search_start + timedelta(weeks=MAX_WEEKS)).replace(tzinfo=timezone.utc).isoformat()

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
    Callable Cloud Function that runs the scheduling algorithm for a lobby.

    Expected input:
        { "lobbyId": "<Firestore lobby document ID>" }

    Flow:
        1. Verify the caller is signed in.
        2. Fetch the lobby document to get memberUids and meetingDuration.
        3. Fetch each member's settings + Google Calendar busy slots from Firestore.
        4. Run the scheduling algorithm.
        5. Return { slots: [...] } or { error: "..." }.
    """
    if req.auth is None:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.UNAUTHENTICATED,
            message='You must be signed in to schedule a meeting.',
        )

    lobby_id: str = req.data.get('lobbyId', '').strip()
    if not lobby_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message='lobbyId is required.',
        )

    client = _get_db()
    search_start = datetime.now()

    # --- 1. Fetch lobby ---
    lobby_doc = client.collection('lobbies').document(lobby_id).get()
    if not lobby_doc.exists:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.NOT_FOUND,
            message='Lobby not found.',
        )

    lobby = lobby_doc.to_dict()
    member_uids: list[str] = lobby.get('memberUids', [])
    meeting_duration: int = lobby.get('meetingDuration', 60)

    if not member_uids:
        return {'error': 'Lobby has no members.'}

    # --- 2. Fetch each member's settings and calendar busy slots ---
    busy_slots_by_participant: dict = {}
    buffer_by_participant: dict = {}
    work_hours_by_participant: dict = {}
    work_days_by_participant: dict = {}
    expired_token_members: list[str] = []

    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue

        user_data: dict = user_doc.to_dict() or {}
        settings: dict = user_data.get('settings', {})
        access_token: str = user_data.get('googleAccessToken', '')

        # Fetch real calendar busy slots
        if access_token:
            busy = _fetch_busy_slots(access_token, search_start)
            if busy is None:
                expired_token_members.append(user_data.get('displayName', uid))
                busy = []
        else:
            busy = []

        busy_slots_by_participant[uid] = busy

        buffer_by_participant[uid] = settings.get('bufferMinutes', 15)

        work_hours_by_participant[uid] = {
            'start_hour':   settings.get('workStartHour', 9),
            'start_minute': settings.get('workStartMinute', 0),
            'end_hour':     settings.get('workEndHour', 17),
            'end_minute':   settings.get('workEndMinute', 0),
        }

        work_days_by_participant[uid] = settings.get('workDays', [0, 1, 2, 3, 4])

    if not work_days_by_participant:
        return {'error': 'No member settings found. Ask all members to complete their settings.'}

    if expired_token_members:
        names = ', '.join(expired_token_members)
        return {
            'error': (
                f'Google Calendar access has expired for: {names}. '
                'Ask them to sign out and sign back in to refresh access.'
            )
        }

    # --- 3. Run the scheduling algorithm ---
    result = find_meeting_slots(
        busy_slots_by_participant=busy_slots_by_participant,
        buffer_by_participant=buffer_by_participant,
        work_hours_by_participant=work_hours_by_participant,
        work_days_by_participant=work_days_by_participant,
        meeting_duration_minutes=meeting_duration,
        search_start=search_start,
        max_weeks=MAX_WEEKS,
    )

    return result
