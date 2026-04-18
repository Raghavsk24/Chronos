from datetime import datetime

import firebase_admin
from firebase_admin import firestore as admin_firestore
from firebase_functions import https_fn

from scheduling.algorithm import find_meeting_slots


def _get_db():
    # Initialize on first actual invocation, not at import time.
    # Calling initialize_app() at module level causes a timeout during
    # Firebase's local introspection phase because it tries to reach the
    # GCP metadata server, which doesn't exist outside of GCP.
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    return admin_firestore.client()


@https_fn.on_call()
def schedule_meeting(req: https_fn.CallableRequest) -> dict:
    """
    Callable Cloud Function that runs the scheduling algorithm for a lobby.

    Expected input:
        { "lobbyId": "<Firestore lobby document ID>" }

    Flow:
        1. Verify the caller is signed in.
        2. Fetch the lobby document to get memberUids and meetingDuration.
        3. Fetch each member's settings (work hours, work days, buffer) from Firestore.
        4. Run the scheduling algorithm (busy slots left empty until Google Calendar step).
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

    # --- 2. Fetch each member's settings from Firestore ---
    busy_slots_by_participant: dict = {}
    buffer_by_participant: dict = {}
    work_hours_by_participant: dict = {}
    work_days_by_participant: dict = {}

    for uid in member_uids:
        user_doc = client.collection('users').document(uid).get()
        if not user_doc.exists:
            continue

        settings: dict = (user_doc.to_dict() or {}).get('settings', {})

        # Busy slots — populated from Google Calendar in the next step
        busy_slots_by_participant[uid] = []

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

    # --- 3. Run the scheduling algorithm ---
    result = find_meeting_slots(
        busy_slots_by_participant=busy_slots_by_participant,
        buffer_by_participant=buffer_by_participant,
        work_hours_by_participant=work_hours_by_participant,
        work_days_by_participant=work_days_by_participant,
        meeting_duration_minutes=meeting_duration,
        search_start=datetime.now(),
    )

    return result
