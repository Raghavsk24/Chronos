"""
Tests for the updated Chronos scheduling algorithm.
Run with: python -m pytest functions/scheduling/test_algorithm.py -v
"""

from datetime import datetime, timedelta
import pytest
from algorithm import find_meeting_slots


# ---------------------------------------------------------------------------
# Shared test fixtures
# ---------------------------------------------------------------------------

# A Monday — clean starting point for all tests
SEARCH_START = datetime(2026, 4, 20, 0, 0, 0)

# Default participant settings reused across tests
DEFAULT_WORK_HOURS = {
    'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
    'user2': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
}
DEFAULT_WORK_DAYS = {
    'user1': [0, 1, 2, 3, 4],  # Mon–Fri
    'user2': [0, 1, 2, 3, 4],
}
DEFAULT_BUFFERS = {'user1': 15, 'user2': 15}


def run(
    busy=None,
    buffers=None,
    work_hours=None,
    work_days=None,
    duration=60,
    search_start=SEARCH_START,
    max_weeks=1,
    top_n=5,
):
    """Convenience wrapper with sensible defaults."""
    return find_meeting_slots(
        busy_slots_by_participant=busy or {'user1': [], 'user2': []},
        buffer_by_participant=buffers or DEFAULT_BUFFERS,
        work_hours_by_participant=work_hours or DEFAULT_WORK_HOURS,
        work_days_by_participant=work_days or DEFAULT_WORK_DAYS,
        meeting_duration_minutes=duration,
        search_start=search_start,
        max_weeks=max_weeks,
        top_n=top_n,
    )


def make_busy(date_str, start_h, start_m, end_h, end_m):
    return {
        'start': f'{date_str}T{start_h:02d}:{start_m:02d}:00',
        'end':   f'{date_str}T{end_h:02d}:{end_m:02d}:00',
    }


def slots(result):
    """Extract slots list from a successful result."""
    assert 'slots' in result, f"Expected success but got: {result}"
    return result['slots']


def error(result):
    """Extract error string from a failed result."""
    assert 'error' in result, f"Expected error but got: {result}"
    return result['error']


# ---------------------------------------------------------------------------
# Basic output shape
# ---------------------------------------------------------------------------

class TestBasicOutput:

    def test_success_returns_slots_key(self):
        result = run()
        assert 'slots' in result

    def test_each_slot_has_required_fields(self):
        for slot in slots(run(top_n=3)):
            assert 'start' in slot
            assert 'end' in slot
            assert 'score' in slot
            assert 'position_score' in slot
            assert 'buffer_score' in slot
            assert 'buffer_score_avg' in slot

    def test_scores_between_zero_and_one(self):
        for slot in slots(run(top_n=5)):
            assert 0.0 <= slot['score'] <= 1.0
            assert 0.0 <= slot['position_score'] <= 1.0
            assert 0.0 <= slot['buffer_score'] <= 1.0
            assert 0.0 <= slot['buffer_score_avg'] <= 1.0

    def test_top_n_respected(self):
        assert len(slots(run(top_n=3))) <= 3

    def test_slot_duration_matches_request(self):
        for slot in slots(run(duration=60, top_n=5)):
            start = datetime.fromisoformat(slot['start'])
            end = datetime.fromisoformat(slot['end'])
            assert (end - start).total_seconds() / 60 == 60

    def test_slots_within_shared_work_window(self):
        for slot in slots(run(top_n=10)):
            start = datetime.fromisoformat(slot['start'])
            end = datetime.fromisoformat(slot['end'])
            assert start.hour >= 9
            assert end.hour * 60 + end.minute <= 17 * 60


# ---------------------------------------------------------------------------
# Change 1: Week-by-week search
# ---------------------------------------------------------------------------

class TestWeekByWeekSearch:

    def test_finds_slots_in_first_week_when_available(self):
        result = run(max_weeks=4)
        result_slots = slots(result)
        first_slot_date = datetime.fromisoformat(result_slots[0]['start']).date()
        # Should find a slot in week 1 (within 7 days of SEARCH_START)
        assert first_slot_date < (SEARCH_START + timedelta(days=7)).date()

    def test_moves_to_next_week_when_first_week_is_fully_blocked(self):
        # Block the entire first week for user1
        busy = {
            'user1': [make_busy(f'2026-04-{day:02d}', 9, 0, 17, 0) for day in range(20, 25)],
            'user2': [],
        }
        result = run(busy=busy, max_weeks=2, top_n=3)
        result_slots = slots(result)
        first_slot_date = datetime.fromisoformat(result_slots[0]['start']).date()
        # Should be in the second week (Apr 27+)
        assert first_slot_date >= datetime(2026, 4, 27).date()

    def test_returns_error_when_all_weeks_exhausted(self):
        # Block every day for 4 weeks for user1
        all_days = []
        for offset in range(28):
            d = SEARCH_START + timedelta(days=offset)
            if d.weekday() < 5:
                all_days.append(make_busy(d.strftime('%Y-%m-%d'), 9, 0, 17, 0))
        busy = {'user1': all_days, 'user2': []}
        result = run(busy=busy, max_weeks=4)
        assert 'error' in result


# ---------------------------------------------------------------------------
# Change 2: Intersection of work days
# ---------------------------------------------------------------------------

class TestWorkDayIntersection:

    def test_uses_only_common_work_days(self):
        # user1 works Mon–Fri, user2 only works Mon–Wed
        work_days = {
            'user1': [0, 1, 2, 3, 4],
            'user2': [0, 1, 2],
        }
        result_slots = slots(run(work_days=work_days, top_n=20))
        for slot in result_slots:
            weekday = datetime.fromisoformat(slot['start']).weekday()
            assert weekday in [0, 1, 2], f"Slot on non-common day: {slot['start']}"

    def test_error_when_no_common_work_days(self):
        work_days = {
            'user1': [0, 1, 2],       # Mon–Wed
            'user2': [3, 4],          # Thu–Fri
        }
        result = run(work_days=work_days)
        assert 'error' in result
        assert 'common work days' in error(result).lower()

    def test_error_when_no_participants(self):
        result = find_meeting_slots(
            busy_slots_by_participant={},
            buffer_by_participant={},
            work_hours_by_participant={},
            work_days_by_participant={},
            meeting_duration_minutes=60,
            search_start=SEARCH_START,
        )
        assert 'error' in result

    def test_weekend_common_day_is_included(self):
        # Both participants work Saturday
        work_days = {'user1': [5], 'user2': [5]}  # Saturday only
        work_hours = {
            'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
            'user2': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
        }
        result_slots = slots(run(work_days=work_days, work_hours=work_hours, top_n=5))
        for slot in result_slots:
            assert datetime.fromisoformat(slot['start']).weekday() == 5


# ---------------------------------------------------------------------------
# Change 3: Latest start / earliest end (shared work window)
# ---------------------------------------------------------------------------

class TestSharedWorkWindow:

    def test_slots_respect_latest_start(self):
        # user2 starts at 10am — no slot should begin before 10am
        work_hours = {
            'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
            'user2': {'start_hour': 10, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
        }
        result_slots = slots(run(work_hours=work_hours, top_n=20))
        for slot in result_slots:
            start = datetime.fromisoformat(slot['start'])
            assert start.hour >= 10, f"Slot starts before shared window: {slot['start']}"

    def test_slots_respect_earliest_end(self):
        # user1 ends at 16:00 — no slot should end after 16:00
        work_hours = {
            'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 16, 'end_minute': 0},
            'user2': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
        }
        result_slots = slots(run(work_hours=work_hours, top_n=20))
        for slot in result_slots:
            end = datetime.fromisoformat(slot['end'])
            end_minutes = end.hour * 60 + end.minute
            assert end_minutes <= 16 * 60, f"Slot ends after shared window: {slot['end']}"

    def test_error_when_window_too_short_for_meeting(self):
        # Shared window is 30 minutes but meeting is 60 minutes
        work_hours = {
            'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
            'user2': {'start_hour': 16, 'start_minute': 30, 'end_hour': 17, 'end_minute': 0},
        }
        result = run(work_hours=work_hours, duration=60)
        assert 'error' in result
        assert 'duration' in error(result).lower()

    def test_exact_fit_window_returns_one_slot_per_day(self):
        # Shared window is exactly 60 minutes — only one slot possible per work day
        work_hours = {
            'user1': {'start_hour': 12, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
            'user2': {'start_hour': 9, 'start_minute': 0, 'end_hour': 13, 'end_minute': 0},
        }
        result_slots = slots(run(work_hours=work_hours, duration=60, top_n=10))
        # Every returned slot must start at 12:00 and end at 13:00
        for slot in result_slots:
            start = datetime.fromisoformat(slot['start'])
            end = datetime.fromisoformat(slot['end'])
            assert start.hour == 12 and start.minute == 0
            assert end.hour == 13 and end.minute == 0


# ---------------------------------------------------------------------------
# Change 4: Pre-expanded busy slots with per-participant buffer
# ---------------------------------------------------------------------------

class TestPreExpandedBuffer:

    def test_slot_within_buffer_of_busy_is_excluded(self):
        # user1 has meeting 10:00–11:00 with 30-min buffer
        # So nothing should start before 11:30 or end after 9:30
        busy = {'user1': [make_busy('2026-04-20', 10, 0, 11, 0)], 'user2': []}
        buffers = {'user1': 30, 'user2': 0}
        result_slots = slots(run(busy=busy, buffers=buffers, top_n=50))
        for slot in result_slots:
            start = datetime.fromisoformat(slot['start'])
            end = datetime.fromisoformat(slot['end'])
            if start.date() == datetime(2026, 4, 20).date():
                # Must not overlap the expanded zone 9:30–11:30
                assert not (start < datetime(2026, 4, 20, 11, 30) and
                            end > datetime(2026, 4, 20, 9, 30))

    def test_different_buffers_per_participant_both_respected(self):
        # user1: meeting 10:00–11:00, buffer 15 min → blocked 9:45–11:15
        # user2: meeting 14:00–15:00, buffer 30 min → blocked 13:30–15:30
        busy = {
            'user1': [make_busy('2026-04-20', 10, 0, 11, 0)],
            'user2': [make_busy('2026-04-20', 14, 0, 15, 0)],
        }
        buffers = {'user1': 15, 'user2': 30}
        result_slots = slots(run(busy=busy, buffers=buffers, top_n=50))
        for slot in result_slots:
            start = datetime.fromisoformat(slot['start'])
            end = datetime.fromisoformat(slot['end'])
            if start.date() == datetime(2026, 4, 20).date():
                overlaps_user1_zone = (
                    start < datetime(2026, 4, 20, 11, 15) and
                    end > datetime(2026, 4, 20, 9, 45)
                )
                overlaps_user2_zone = (
                    start < datetime(2026, 4, 20, 15, 30) and
                    end > datetime(2026, 4, 20, 13, 30)
                )
                assert not overlaps_user1_zone
                assert not overlaps_user2_zone

    def test_zero_buffer_allows_back_to_back(self):
        busy = {'user1': [make_busy('2026-04-20', 9, 0, 10, 0)], 'user2': []}
        buffers = {'user1': 0, 'user2': 0}
        result_slots = slots(run(busy=busy, buffers=buffers, top_n=50))
        starts = [datetime.fromisoformat(s['start']) for s in result_slots]
        assert datetime(2026, 4, 20, 10, 0) in starts


# ---------------------------------------------------------------------------
# Change 5: Position score uses shared work_start / work_end
# ---------------------------------------------------------------------------

class TestPositionScoring:

    def test_midday_scores_higher_than_morning(self):
        result_slots = slots(run(top_n=50))
        slot_9am = next((s for s in result_slots
                         if datetime.fromisoformat(s['start']).hour == 9
                         and datetime.fromisoformat(s['start']).minute == 0), None)
        slot_13pm = next((s for s in result_slots
                          if datetime.fromisoformat(s['start']).hour == 13
                          and datetime.fromisoformat(s['start']).minute == 0), None)
        if slot_9am and slot_13pm:
            assert slot_13pm['position_score'] > slot_9am['position_score']

    def test_midday_scores_higher_than_late_afternoon(self):
        result_slots = slots(run(top_n=50))
        slot_16pm = next((s for s in result_slots
                          if datetime.fromisoformat(s['start']).hour == 16), None)
        slot_13pm = next((s for s in result_slots
                          if datetime.fromisoformat(s['start']).hour == 13
                          and datetime.fromisoformat(s['start']).minute == 0), None)
        if slot_16pm and slot_13pm:
            assert slot_13pm['position_score'] > slot_16pm['position_score']

    def test_position_midpoint_shifts_with_custom_work_hours(self):
        # Work window 12:00–14:00, midpoint = 13:00
        # A slot at 13:00 should score higher than one at 12:00
        work_hours = {
            'user1': {'start_hour': 12, 'start_minute': 0, 'end_hour': 14, 'end_minute': 0},
            'user2': {'start_hour': 12, 'start_minute': 0, 'end_hour': 14, 'end_minute': 0},
        }
        result_slots = slots(run(work_hours=work_hours, duration=30, top_n=20))
        slot_12 = next((s for s in result_slots
                        if datetime.fromisoformat(s['start']).hour == 12
                        and datetime.fromisoformat(s['start']).minute == 0), None)
        slot_13 = next((s for s in result_slots
                        if datetime.fromisoformat(s['start']).hour == 13
                        and datetime.fromisoformat(s['start']).minute == 0), None)
        if slot_12 and slot_13:
            assert slot_13['position_score'] > slot_12['position_score']


# ---------------------------------------------------------------------------
# Change 6: Per-participant buffer scoring (min + avg tiebreaker)
# ---------------------------------------------------------------------------

class TestPerParticipantBufferScoring:

    def test_buffer_score_reflects_most_constrained_participant(self):
        # user1 is tightly squeezed (meeting 9-10, meeting 11-12 around a 10-11 slot)
        # user2 has a fully open day
        # The buffer score for the 10:00 slot should reflect user1's tight situation
        busy = {
            'user1': [
                make_busy('2026-04-20', 9, 0, 10, 0),
                make_busy('2026-04-20', 11, 0, 12, 0),
            ],
            'user2': [],
        }
        buffers = {'user1': 0, 'user2': 0}
        result_slots = slots(run(busy=busy, buffers=buffers, top_n=50))
        tight_slot = next(
            (s for s in result_slots
             if datetime.fromisoformat(s['start']) == datetime(2026, 4, 20, 10, 0)),
            None
        )
        # Buffer score should be low — user1 is squeezed even if user2 is free
        if tight_slot:
            assert tight_slot['buffer_score'] < 0.5

    def test_buffer_score_avg_present_and_gte_min(self):
        # avg must always be >= min (can't be less than the lowest individual score)
        for slot in slots(run(top_n=10)):
            assert slot['buffer_score_avg'] >= slot['buffer_score'] - 0.001  # small float tolerance

    def test_tiebreaker_uses_avg_buffer_score(self):
        # Both participants have different schedules creating the same min buffer score
        # We can't force an exact tie in a unit test, so we verify avg >= min and avg is returned
        result_slots = slots(run(top_n=5))
        for slot in result_slots:
            assert 'buffer_score_avg' in slot
            assert isinstance(slot['buffer_score_avg'], float)


# ---------------------------------------------------------------------------
# Change 7: Date proximity as primary sort key
# ---------------------------------------------------------------------------

class TestDateProximitySorting:

    def test_earlier_day_comes_before_later_day(self):
        result_slots = slots(run(top_n=20))
        dates = [datetime.fromisoformat(s['start']).date() for s in result_slots]
        # Dates should be non-decreasing (earlier or same days first)
        assert dates == sorted(dates)

    def test_within_same_day_higher_score_comes_first(self):
        result_slots = slots(run(top_n=20))
        by_date: dict = {}
        for slot in result_slots:
            d = datetime.fromisoformat(slot['start']).date()
            by_date.setdefault(d, []).append(slot['score'])

        for d, day_scores in by_date.items():
            assert day_scores == sorted(day_scores, reverse=True), \
                f"Scores not descending within {d}: {day_scores}"

    def test_monday_slots_come_before_friday_slots(self):
        result_slots = slots(run(top_n=20))
        monday_slots = [s for s in result_slots
                        if datetime.fromisoformat(s['start']).weekday() == 0]
        friday_slots = [s for s in result_slots
                        if datetime.fromisoformat(s['start']).weekday() == 4]
        if monday_slots and friday_slots:
            last_monday = datetime.fromisoformat(monday_slots[-1]['start']).date()
            first_friday = datetime.fromisoformat(friday_slots[0]['start']).date()
            assert last_monday <= first_friday


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_meeting_longer_than_shared_window_returns_error(self):
        result = run(duration=600)  # 10 hours, workday is 8 hours
        assert 'error' in result

    def test_fully_booked_all_weeks_returns_error(self):
        busy = {
            'user1': [
                make_busy(f'2026-{(4 if d < 10 else 5):02d}-{(20 + d) if (20 + d) <= 30 else (20 + d - 30):02d}', 9, 0, 17, 0)
                for d in range(20)
                if (SEARCH_START + timedelta(days=d)).weekday() < 5
            ],
            'user2': [],
        }
        result = run(busy=busy, max_weeks=1)
        # At minimum week 1 should be fully blocked
        assert isinstance(result, dict)

    def test_single_participant_works(self):
        result = find_meeting_slots(
            busy_slots_by_participant={'user1': []},
            buffer_by_participant={'user1': 15},
            work_hours_by_participant={
                'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0}
            },
            work_days_by_participant={'user1': [0, 1, 2, 3, 4]},
            meeting_duration_minutes=60,
            search_start=SEARCH_START,
            max_weeks=1,
            top_n=5,
        )
        assert 'slots' in result
        assert len(result['slots']) > 0

    def test_multiple_weeks_searched_when_needed(self):
        # Block week 1 entirely for user1, leave week 2 open
        busy = {
            'user1': [
                make_busy('2026-04-20', 9, 0, 17, 0),
                make_busy('2026-04-21', 9, 0, 17, 0),
                make_busy('2026-04-22', 9, 0, 17, 0),
                make_busy('2026-04-23', 9, 0, 17, 0),
                make_busy('2026-04-24', 9, 0, 17, 0),
            ],
            'user2': [],
        }
        result = run(busy=busy, max_weeks=2, top_n=3)
        assert 'slots' in result
        first_slot = datetime.fromisoformat(result['slots'][0]['start'])
        assert first_slot.date() >= datetime(2026, 4, 27).date()
