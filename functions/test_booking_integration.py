import io
import urllib.error

import pytest
from firebase_functions import https_fn

import main


class _FakeResponse:
    def __init__(self, status: int):
        self.status = status

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


def _seed_db(host_token='host-token'):
    return _FakeDb(
        {
            'meetings': {
                'm1': {
                    'hostUid': 'host-uid',
                    'memberUids': ['host-uid', 'member-uid'],
                    'name': 'Core Sync',
                    'meetingLink': 'https://meet.google.com/abc-defg-hij',
                    'status': 'scheduling',
                }
            },
            'users': {
                'host-uid': {
                    'email': 'host@example.com',
                    'googleAccessToken': host_token,
                },
                'member-uid': {
                    'email': 'member@example.com',
                    'googleAccessToken': 'member-token',
                },
            },
        }
    )


def test_create_calendar_event_returns_true_on_200(monkeypatch):
    monkeypatch.setattr(main.urllib.request, 'urlopen', lambda *args, **kwargs: _FakeResponse(200))

    ok = main._create_calendar_event(
        'token',
        'Weekly Sync',
        '2026-05-01T10:00:00',
        '2026-05-01T11:00:00',
        ['a@example.com'],
    )

    assert ok is True


def test_create_calendar_event_returns_false_on_401(monkeypatch):
    def _raise_401(*args, **kwargs):
        raise urllib.error.HTTPError(
            url='https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
            code=401,
            msg='Unauthorized',
            hdrs=None,
            fp=io.BytesIO(b'{"error":"unauthorized"}'),
        )

    monkeypatch.setattr(main.urllib.request, 'urlopen', _raise_401)

    ok = main._create_calendar_event(
        'bad-token',
        'Weekly Sync',
        '2026-05-01T10:00:00',
        '2026-05-01T11:00:00',
        ['a@example.com'],
    )

    assert ok is False


def test_create_calendar_event_returns_false_on_500(monkeypatch):
    def _raise_500(*args, **kwargs):
        raise urllib.error.HTTPError(
            url='https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
            code=500,
            msg='Server Error',
            hdrs=None,
            fp=io.BytesIO(b'{"error":"server_error"}'),
        )

    monkeypatch.setattr(main.urllib.request, 'urlopen', _raise_500)

    ok = main._create_calendar_event(
        'token',
        'Weekly Sync',
        '2026-05-01T10:00:00',
        '2026-05-01T11:00:00',
        ['a@example.com'],
    )

    assert ok is False


def test_book_meeting_impl_updates_status_only_on_success():
    db = _seed_db()

    result = main._book_meeting_impl(
        data={
            'meetingId': 'm1',
            'slotStart': '2026-05-01T10:00:00',
            'slotEnd': '2026-05-01T11:00:00',
        },
        auth_uid='host-uid',
        client=db,
        create_event_fn=lambda *_args: True,
    )

    assert result['success'] is True
    assert result['attendeeCount'] == 2
    meeting = db._seed['meetings']['m1']
    assert meeting['status'] == 'scheduled'
    assert meeting['scheduledSlot']['start'] == '2026-05-01T10:00:00'


def test_book_meeting_impl_raises_internal_when_calendar_create_fails():
    db = _seed_db()

    with pytest.raises(https_fn.HttpsError) as exc_info:
        main._book_meeting_impl(
            data={
                'meetingId': 'm1',
                'slotStart': '2026-05-01T10:00:00',
                'slotEnd': '2026-05-01T11:00:00',
            },
            auth_uid='host-uid',
            client=db,
            create_event_fn=lambda *_args: False,
        )

    assert exc_info.value.code == https_fn.FunctionsErrorCode.INTERNAL
    assert db._seed['meetings']['m1']['status'] == 'scheduling'


def test_book_meeting_impl_raises_when_host_token_missing():
    db = _seed_db(host_token='')

    with pytest.raises(https_fn.HttpsError) as exc_info:
        main._book_meeting_impl(
            data={
                'meetingId': 'm1',
                'slotStart': '2026-05-01T10:00:00',
                'slotEnd': '2026-05-01T11:00:00',
            },
            auth_uid='host-uid',
            client=db,
            create_event_fn=lambda *_args: True,
        )

    assert exc_info.value.code == https_fn.FunctionsErrorCode.FAILED_PRECONDITION


def test_book_meeting_impl_passes_meeting_link_to_calendar_event():
    db = _seed_db()
    captured = {}

    def _fake_create_event(token, summary, slot_start, slot_end, attendee_emails, meeting_link):
        captured['token'] = token
        captured['summary'] = summary
        captured['slot_start'] = slot_start
        captured['slot_end'] = slot_end
        captured['attendee_emails'] = attendee_emails
        captured['meeting_link'] = meeting_link
        return True

    main._book_meeting_impl(
        data={
            'meetingId': 'm1',
            'slotStart': '2026-05-01T10:00:00',
            'slotEnd': '2026-05-01T11:00:00',
        },
        auth_uid='host-uid',
        client=db,
        create_event_fn=_fake_create_event,
    )

    assert captured['meeting_link'] == 'https://meet.google.com/abc-defg-hij'
