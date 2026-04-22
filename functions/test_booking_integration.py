import io
import json
import urllib.error

import pytest
from firebase_functions import https_fn

import main


class _FakeResponse:
    def __init__(self, status: int, body: dict | None = None):
        self.status = status
        self._body = body or {}

    def read(self):
        return json.dumps(self._body).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeDocSnapshot:
    def __init__(self, data):
        self._data = data

    @property
    def exists(self):
        return self._data is not None

    def to_dict(self):
        return self._data


class _FakeDocRef:
    def __init__(self, store, doc_id):
        self._store = store
        self._doc_id = doc_id

    def get(self):
        return _FakeDocSnapshot(self._store.get(self._doc_id))

    def update(self, updates):
        if self._doc_id not in self._store:
            self._store[self._doc_id] = {}
        self._store[self._doc_id].update(updates)


class _FakeCollection:
    def __init__(self, store):
        self._store = store

    def document(self, doc_id):
        return _FakeDocRef(self._store, doc_id)


class _FakeDb:
    def __init__(self, seed):
        self._seed = seed

    def collection(self, name):
        return _FakeCollection(self._seed.setdefault(name, {}))


def _seed_db(host_token="host-token", member_token="member-token"):
    return _FakeDb(
        {
            "meetings": {
                "m1": {
                    "hostUid": "host-uid",
                    "memberUids": ["host-uid", "member-uid"],
                    "name": "Core Sync",
                    "meetingLink": "https://meet.google.com/abc-defg-hij",
                    "status": "scheduling",
                }
            },
            "users": {
                "host-uid": {
                    "displayName": "Host",
                    "email": "host@example.com",
                    "googleAccessToken": host_token,
                    "settings": {"timezone": "America/New_York"},
                },
                "member-uid": {
                    "displayName": "Member",
                    "email": "member@example.com",
                    "googleAccessToken": member_token,
                    "settings": {"timezone": "Europe/London"},
                },
            },
        }
    )


def test_create_calendar_event_returns_event_id_on_200(monkeypatch):
    monkeypatch.setattr(
        main.urllib.request,
        "urlopen",
        lambda *args, **kwargs: _FakeResponse(200, {"id": "evt-123"}),
    )

    event_id = main._create_calendar_event(
        "token",
        "Weekly Sync",
        "2026-05-01T10:00:00",
        "2026-05-01T11:00:00",
        ["a@example.com"],
        time_zone="America/New_York",
    )

    assert event_id == "evt-123"


def test_create_calendar_event_returns_empty_string_on_401(monkeypatch):
    def _raise_401(*args, **kwargs):
        raise urllib.error.HTTPError(
            url="https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=io.BytesIO(b'{"error":"unauthorized"}'),
        )

    monkeypatch.setattr(main.urllib.request, "urlopen", _raise_401)

    event_id = main._create_calendar_event(
        "bad-token",
        "Weekly Sync",
        "2026-05-01T10:00:00",
        "2026-05-01T11:00:00",
        ["a@example.com"],
        time_zone="America/New_York",
    )

    assert event_id == ""


def test_book_meeting_impl_updates_status_on_success():
    db = _seed_db()

    result = main._book_meeting_impl(
        data={
            "meetingId": "m1",
            "slotStart": "2026-05-01T10:00:00",
            "slotEnd": "2026-05-01T11:00:00",
        },
        auth_uid="host-uid",
        client=db,
        create_event_fn=lambda *args, **kwargs: "event-id",
    )

    assert result["success"] is True
    assert result["attendeeCount"] == 2
    meeting = db._seed["meetings"]["m1"]
    assert meeting["status"] == "scheduled"
    assert meeting["scheduledSlot"]["start"] == "2026-05-01T10:00:00"


def test_book_meeting_impl_requires_all_member_calendar_connections():
    db = _seed_db(member_token="")

    with pytest.raises(https_fn.HttpsError) as exc_info:
        main._book_meeting_impl(
            data={
                "meetingId": "m1",
                "slotStart": "2026-05-01T10:00:00",
                "slotEnd": "2026-05-01T11:00:00",
            },
            auth_uid="host-uid",
            client=db,
            create_event_fn=lambda *_args: "event-id",
        )

    assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


def test_book_meeting_impl_passes_meeting_link_to_calendar_event():
    db = _seed_db()
    captured = []

    def _fake_create_event(token, summary, slot_start, slot_end, attendee_emails, meeting_link, time_zone='UTC'):
        captured.append({"meeting_link": meeting_link, "time_zone": time_zone, "token": token})
        return "event-id"

    main._book_meeting_impl(
        data={
            "meetingId": "m1",
            "slotStart": "2026-05-01T10:00:00",
            "slotEnd": "2026-05-01T11:00:00",
        },
        auth_uid="host-uid",
        client=db,
        create_event_fn=_fake_create_event,
    )

    assert captured[0]["meeting_link"] == "https://meet.google.com/abc-defg-hij"
    assert captured[0]["time_zone"] == "America/New_York"
    assert captured[1]["time_zone"] == "Europe/London"


def test_create_calendar_event_localizes_to_participant_timezone(monkeypatch):
    captured = {}

    def _fake_urlopen(request, timeout=10):
        captured["body"] = json.loads(request.data.decode("utf-8"))
        return _FakeResponse(200, {"id": "evt-123"})

    monkeypatch.setattr(main.urllib.request, "urlopen", _fake_urlopen)

    main._create_calendar_event(
        "token",
        "Weekly Sync",
        "2026-05-01T14:00:00",
        "2026-05-01T15:00:00",
        ["a@example.com"],
        time_zone="America/New_York",
    )

    assert captured["body"]["start"]["timeZone"] == "America/New_York"
    assert captured["body"]["start"]["dateTime"].startswith("2026-05-01T10:00:00")
