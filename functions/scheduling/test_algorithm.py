from datetime import datetime

from scheduling.algorithm import find_meeting_slots


def _run(
    *,
    busy=None,
    work_hours=None,
    work_days=None,
    duration=60,
    search_start=datetime(2026, 4, 21, 4, 27, 0),
    preferences=None,
    top_n=5,
):
    return find_meeting_slots(
        busy_slots_by_participant=busy or {"u1": [], "u2": []},
        buffer_by_participant={"u1": 0, "u2": 0},
        work_hours_by_participant=work_hours
        or {
            "u1": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 17,
                "end_minute": 0,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 17,
                "end_minute": 0,
                "timezone": "UTC",
            },
        },
        work_days_by_participant=work_days or {"u1": [0, 1, 2, 3, 4], "u2": [0, 1, 2, 3, 4]},
        meeting_duration_minutes=duration,
        search_start=search_start,
        preferences=preferences or {},
        top_n=top_n,
    )


def test_returns_ranked_slots_with_expected_fields():
    result = _run()
    assert "slots" in result
    assert len(result["slots"]) <= 5
    slot = result["slots"][0]
    assert set(slot.keys()) == {
        "start",
        "end",
        "score",
        "proximity_score",
        "position_score",
        "buffer_score",
        "buffer_score_avg",
    }


def test_no_shared_work_days_returns_error():
    result = _run(work_days={"u1": [0], "u2": [1]})
    assert "error" in result
    assert "shared work days" in result["error"].lower()


def test_shared_window_must_fit_duration():
    result = _run(
        duration=120,
        work_hours={
            "u1": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 17,
                "end_minute": 0,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 16,
                "start_minute": 30,
                "end_hour": 17,
                "end_minute": 0,
                "timezone": "UTC",
            },
        },
    )
    assert "error" in result
    assert "duration" in result["error"].lower()


def test_search_starts_one_hour_then_rounded_to_15_minutes():
    result = _run(
        work_hours={
            "u1": {
                "start_hour": 0,
                "start_minute": 0,
                "end_hour": 23,
                "end_minute": 59,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 0,
                "start_minute": 0,
                "end_hour": 23,
                "end_minute": 59,
                "timezone": "UTC",
            },
        },
    )
    baseline = datetime(2026, 4, 21, 5, 30)
    for slot in result["slots"]:
        slot_start = datetime.fromisoformat(slot["start"])
        assert slot_start >= baseline
        assert slot_start.minute in {0, 15, 30, 45}


def test_target_date_slots_rank_higher_by_proximity():
    result = _run(
        preferences={"targetDates": ["2026-04-22"]},
        work_hours={
            "u1": {
                "start_hour": 0,
                "start_minute": 0,
                "end_hour": 23,
                "end_minute": 59,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 0,
                "start_minute": 0,
                "end_hour": 23,
                "end_minute": 59,
                "timezone": "UTC",
            },
        },
    )
    top_slot_date = datetime.fromisoformat(result["slots"][0]["start"]).date().isoformat()
    assert top_slot_date == "2026-04-22"


def test_extra_buffer_requires_30_more_minutes_in_window():
    result = _run(
        duration=60,
        preferences={"extraBuffer": True},
        work_hours={
            "u1": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 10,
                "end_minute": 0,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 10,
                "end_minute": 0,
                "timezone": "UTC",
            },
        },
    )
    assert "error" in result


def test_buffer_score_removes_slot_if_5_min_buffer_fails():
    busy = {
        "u1": [
            {"start": "2026-04-21T10:04:00", "end": "2026-04-21T11:00:00"},
        ],
        "u2": [],
    }
    result = _run(
        busy=busy,
        duration=60,
        work_hours={
            "u1": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 10,
                "end_minute": 0,
                "timezone": "UTC",
            },
            "u2": {
                "start_hour": 9,
                "start_minute": 0,
                "end_hour": 10,
                "end_minute": 0,
                "timezone": "UTC",
            },
        },
    )
    assert "slots" in result
    blocked_start = "2026-04-21T09:00:00"
    assert all(slot["start"] != blocked_start for slot in result["slots"])
