"""
Chronos Scheduling Algorithm
------------------------------
Finds and ranks available meeting slots across all participants,
respecting individual work hours, work days, buffer times, and calendar conflicts.
"""

from datetime import datetime, timedelta, time as dtime, timezone, date as ddate
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from zoneinfo import ZoneInfo


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TimeSlot:
    """A block of time with a start and end."""
    start: datetime
    end: datetime

    def overlaps(self, other: 'TimeSlot') -> bool:
        """Returns True if this slot overlaps with another (no buffer — expansion is pre-applied)."""
        return self.start < other.end and self.end > other.start


@dataclass
class ScoredSlot:
    """A candidate meeting slot with its ranking scores."""
    start: datetime
    end: datetime
    score: float            # Final weighted score (0.0–1.0)
    position_score: float   # How close to the middle of the shared work window
    buffer_score: float     # Minimum buffer score across all participants
    buffer_score_avg: float # Average buffer score across all participants (tiebreaker)

    def to_dict(self) -> dict:
        return {
            'start': self.start.isoformat(),
            'end': self.end.isoformat(),
            'score': round(self.score, 3),
            'position_score': round(self.position_score, 3),
            'buffer_score': round(self.buffer_score, 3),
            'buffer_score_avg': round(self.buffer_score_avg, 3),
        }


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _minutes_since_midnight(dt: datetime) -> float:
    return dt.hour * 60 + dt.minute


def _score_position(
    slot_start: datetime,
    slot_end: datetime,
    day_start: datetime,
    day_end: datetime,
    day_part: Optional[str] = None,
) -> float:
    """
    Score the slot's position within the shared work window.

    day_part controls the preference:
      None / 'midday' : highest score at centre (default)
      'morning'       : highest score at start of window
      'afternoon'     : highest score at end of window
    """
    ws = _minutes_since_midnight(day_start)
    we = _minutes_since_midnight(day_end)
    window_length = we - ws
    if window_length == 0:
        return 1.0

    slot_midpoint = (
        _minutes_since_midnight(slot_start) + _minutes_since_midnight(slot_end)
    ) / 2

    # Normalized position: 0.0 = start of window, 1.0 = end of window
    normalized = max(0.0, min(1.0, (slot_midpoint - ws) / window_length))

    if day_part == 'morning':
        return 1.0 - normalized
    elif day_part == 'afternoon':
        return normalized
    else:
        # Midday (default): peak at centre
        return 1.0 - abs(0.5 - normalized) * 2


def _score_buffer_for_participant(
    slot_start: datetime,
    slot_end: datetime,
    participant_slots: List[TimeSlot],
    day_start: datetime,
    day_end: datetime,
) -> float:
    """
    Score the breathing room around a slot from one participant's perspective.

    Uses the participant's original (un-expanded) busy slots so that buffer
    padding is not double-counted. Measures the gap between the candidate
    slot and the participant's nearest events on each side.
    """

    # Nearest busy event ending before our slot (fallback: start of work window)
    prev_end = day_start
    for busy in participant_slots:
        if busy.end <= slot_start and busy.end > prev_end:
            prev_end = busy.end

    # Nearest busy event starting after our slot (fallback: end of work window)
    next_start = day_end
    for busy in participant_slots:
        if busy.start >= slot_end and busy.start < next_start:
            next_start = busy.start

    before_gap = (slot_start - prev_end).total_seconds() / 60
    after_gap = (next_start - slot_end).total_seconds() / 60

    # Normalise: 120+ minutes of gap = full score on that side
    before_score = min(before_gap / 120.0, 1.0)
    after_score = min(after_gap / 120.0, 1.0)
    return (before_score + after_score) / 2


def _score_buffer_all_participants(
    slot_start: datetime,
    slot_end: datetime,
    busy_by_participant_original: Dict[str, List[TimeSlot]],
    day_start: datetime,
    day_end: datetime,
) -> Tuple[float, float]:
    """
    Calculate buffer scores for every participant, then return:
      - min_score: the lowest score (most constrained participant drives the result)
      - avg_score: the average score (used to break ties between slots with equal min scores)
    """
    if not busy_by_participant_original:
        return 1.0, 1.0

    scores = [
        _score_buffer_for_participant(slot_start, slot_end, slots, day_start, day_end)
        for slots in busy_by_participant_original.values()
    ]

    return min(scores), sum(scores) / len(scores)


# ---------------------------------------------------------------------------
# Main function
# ---------------------------------------------------------------------------

def find_meeting_slots(
    busy_slots_by_participant: Dict[str, List[dict]],
    buffer_by_participant: Dict[str, int],
    work_hours_by_participant: Dict[str, dict],
    work_days_by_participant: Dict[str, List[int]],
    meeting_duration_minutes: int,
    search_start: datetime,
    max_weeks: int = 4,
    step_minutes: int = 15,
    position_weight: float = 0.5,
    buffer_weight: float = 0.5,
    top_n: int = 5,
    preferences: Optional[dict] = None,
) -> dict:
    """
    Find and rank available meeting slots for all participants.

    Returns {'slots': [...]} on success, {'error': '...'} on failure.

    Parameters
    ----------
    busy_slots_by_participant : dict
        Raw calendar events per participant. Each value is a list of dicts
        with 'start' and 'end' as ISO 8601 strings.
        Example:
            {
                'user1': [{'start': '2026-04-20T09:00:00', 'end': '2026-04-20T10:00:00'}],
                'user2': [{'start': '2026-04-20T14:00:00', 'end': '2026-04-20T15:00:00'}],
            }

    buffer_by_participant : dict
        Buffer minutes per participant (e.g. {'user1': 15, 'user2': 30}).

    work_hours_by_participant : dict
        Work hours per participant. Each value has:
            start_hour, start_minute, end_hour, end_minute
        Example:
            {
                'user1': {'start_hour': 9, 'start_minute': 0, 'end_hour': 17, 'end_minute': 0},
                'user2': {'start_hour': 10, 'start_minute': 0, 'end_hour': 18, 'end_minute': 0},
            }
        The algorithm uses the latest start and earliest end across all participants.

    work_days_by_participant : dict
        Work days per participant as lists of ints (0=Monday, 6=Sunday).
        Example: {'user1': [0,1,2,3,4], 'user2': [0,1,2,3,4,5]}
        The algorithm uses only the intersection (days ALL participants work).

    meeting_duration_minutes : int
        How long the meeting needs to be.

    search_start : datetime
        The earliest datetime to begin searching from.

    max_weeks : int
        Maximum number of weekly windows to search before giving up (default 4).

    step_minutes : int
        Granularity of candidate slot generation in minutes (default 15).

    position_weight : float
        Weight of position score in the final score (default 0.5).

    buffer_weight : float
        Weight of buffer score in the final score (default 0.5).

    top_n : int
        Maximum number of results to return per week (default 5).
    """

    # -----------------------------------------------------------------------
    # Extract scheduling preferences
    # -----------------------------------------------------------------------
    prefs = preferences or {}
    day_part: Optional[str] = prefs.get('dayPart')  # 'morning' | 'midday' | 'afternoon' | None

    # extraBuffer: add 30 min to effective duration so the slot search
    # accounts for meetings running over time.
    if prefs.get('extraBuffer'):
        meeting_duration_minutes += 30

    # targetDates: restrict search to specific calendar dates only.
    target_dates: set[ddate] = set()
    for d_str in (prefs.get('targetDates') or []):
        try:
            target_dates.add(ddate.fromisoformat(d_str))
        except ValueError:
            pass

    # -----------------------------------------------------------------------
    # Compute intersection of work days across all participants
    # -----------------------------------------------------------------------
    if not work_days_by_participant:
        return {'error': 'No participants provided.'}

    participant_ids = list(work_days_by_participant.keys())
    common_work_days = set(work_days_by_participant[participant_ids[0]])
    for days in work_days_by_participant.values():
        common_work_days &= set(days)

    if not common_work_days:
        return {
            'error': (
                'No common work days found among all participants. '
                'Every participant must share at least one work day for scheduling to work. '
                'Ask participants to review and update their work day settings.'
            )
        }

    work_days = sorted(common_work_days)

    meeting_duration = timedelta(minutes=meeting_duration_minutes)
    work_days_evaluated = 0        # updated by the unrestricted _search pass
    work_days_with_sufficient_window = 0

    # -----------------------------------------------------------------------
    # Change 4: Build two separate busy slot lists
    #
    # all_busy_expanded  — each slot pre-padded with that participant's buffer.
    #                      Used for conflict detection. No buffer applied at
    #                      check time since it is already baked in.
    #
    # busy_by_participant_original — raw unmodified slots per participant.
    #                      Used for buffer scoring only, so buffer is not
    #                      double-counted in the score calculation.
    # -----------------------------------------------------------------------
    busy_by_participant_original: Dict[str, List[TimeSlot]] = {}
    for uid, slots in busy_slots_by_participant.items():
        busy_by_participant_original[uid] = [
            TimeSlot(
                start=datetime.fromisoformat(s['start']),
                end=datetime.fromisoformat(s['end']),
            )
            for s in slots
        ]

    all_busy_expanded: List[TimeSlot] = []
    for uid, slots in busy_slots_by_participant.items():
        buf = buffer_by_participant.get(uid, 0)
        for s in slots:
            all_busy_expanded.append(TimeSlot(
                start=datetime.fromisoformat(s['start']) - timedelta(minutes=buf),
                end=datetime.fromisoformat(s['end']) + timedelta(minutes=buf),
            ))
    all_busy_expanded.sort(key=lambda s: s.start)

    # -----------------------------------------------------------------------
    # Search helper: scan the week window optionally restricted to a date set
    # -----------------------------------------------------------------------
    def _search(date_filter: Optional[set]) -> Optional[List[ScoredSlot]]:
        """Return top scored slots, or None if nothing found."""
        _evaluated = 0
        _sufficient = 0

        for week in range(max_weeks):
            week_start = search_start + timedelta(weeks=week)
            week_end = week_start + timedelta(days=7)

            scored_slots: List[ScoredSlot] = []
            current_day = week_start.replace(hour=0, minute=0, second=0, microsecond=0)

            while current_day < week_end:
                # When a date filter is active, skip days not in the allowed set.
                if date_filter is not None and current_day.date() not in date_filter:
                    current_day += timedelta(days=1)
                    continue

                if current_day.weekday() in work_days:
                    _evaluated += 1
                    # Convert each participant's local work hours to UTC for this day,
                    # then intersect (latest start, earliest end) to get the shared window.
                    utc_starts = []
                    utc_ends = []
                    for wh in work_hours_by_participant.values():
                        tz = ZoneInfo(wh.get('timezone', 'UTC'))
                        local_start = datetime(
                            current_day.year, current_day.month, current_day.day,
                            wh['start_hour'], wh['start_minute'], tzinfo=tz,
                        )
                        local_end = datetime(
                            current_day.year, current_day.month, current_day.day,
                            wh['end_hour'], wh['end_minute'], tzinfo=tz,
                        )
                        utc_starts.append(local_start.astimezone(timezone.utc).replace(tzinfo=None))
                        utc_ends.append(local_end.astimezone(timezone.utc).replace(tzinfo=None))

                    day_start = max(utc_starts)
                    day_end = min(utc_ends)

                    if (day_end - day_start).total_seconds() / 60 < meeting_duration_minutes:
                        current_day += timedelta(days=1)
                        continue

                    _sufficient += 1

                    candidate_start = day_start
                    while candidate_start + meeting_duration <= day_end:
                        candidate_end = candidate_start + meeting_duration
                        candidate = TimeSlot(start=candidate_start, end=candidate_end)

                        has_conflict = any(
                            candidate.overlaps(busy) for busy in all_busy_expanded
                        )

                        if not has_conflict:
                            pos_score = _score_position(
                                candidate_start, candidate_end, day_start, day_end, day_part
                            )
                            buf_min, buf_avg = _score_buffer_all_participants(
                                candidate_start, candidate_end,
                                busy_by_participant_original,
                                day_start, day_end,
                            )
                            final_score = (
                                (position_weight * pos_score) +
                                (buffer_weight * buf_min)
                            )
                            scored_slots.append(ScoredSlot(
                                start=candidate_start,
                                end=candidate_end,
                                score=final_score,
                                position_score=pos_score,
                                buffer_score=buf_min,
                                buffer_score_avg=buf_avg,
                            ))

                        candidate_start += timedelta(minutes=step_minutes)

                current_day += timedelta(days=1)

            if scored_slots:
                scored_slots.sort(
                    key=lambda s: (s.start.date(), -s.score, -s.buffer_score_avg)
                )
                return scored_slots[:top_n]

        # Track for error diagnosis (only meaningful on the unrestricted pass)
        nonlocal work_days_evaluated, work_days_with_sufficient_window
        work_days_evaluated = _evaluated
        work_days_with_sufficient_window = _sufficient
        return None

    # -----------------------------------------------------------------------
    # Phase 1: if target dates were requested, try exact dates first.
    # Phase 2: fall back to all working days within the search window,
    #          sorted closest-first (this is the default when no target dates).
    # -----------------------------------------------------------------------
    if target_dates:
        slots = _search(date_filter=target_dates)
        if slots:
            return {'slots': [s.to_dict() for s in slots]}

    slots = _search(date_filter=None)
    if slots:
        return {'slots': [s.to_dict() for s in slots]}

    if work_days_evaluated > 0 and work_days_with_sufficient_window == 0:
        return {
            'error': (
                'Meeting duration is longer than the shared work window across participants. '
                'Reduce duration or update work hour settings.'
            )
        }

    return {
        'error': (
            f'No available meeting slots found in the next {max_weeks} weeks. '
            'Participants may need to clear some calendar time or adjust their work hour settings.'
        )
    }
