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
    proximity_score: Optional[float] = None  # None when no target date; 1/(1+days_away) otherwise

    def to_dict(self) -> dict:
        return {
            'start': self.start.isoformat(),
            'end': self.end.isoformat(),
            'score': round(self.score, 3),
            'position_score': round(self.position_score, 3),
            'buffer_score': round(self.buffer_score, 3),
            'buffer_score_avg': round(self.buffer_score_avg, 3),
            'proximity_score': round(self.proximity_score, 3) if self.proximity_score is not None else None,
        }


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _score_position(
    slot_start: datetime,
    slot_end: datetime,
    day_start: datetime,
    day_end: datetime,
    day_part: Optional[str] = None,
) -> float:
    """
    Score the slot's position within the shared work window using thirds.

    The window is divided into three equal thirds — morning, midday, afternoon.
    Score is 1.0 at the centre of the preferred third and decays linearly to 0.0
    at the centre of the opposite third.

    Uses timedelta arithmetic (not minutes-since-midnight) so it is correct even
    when work hours span midnight UTC, which happens for US/Western timezones.
    """
    window_secs = (day_end - day_start).total_seconds()
    if window_secs <= 0:
        return 1.0

    slot_mid_secs = (
        (slot_start - day_start).total_seconds()
        + (slot_end - day_start).total_seconds()
    ) / 2
    normalized = max(0.0, min(1.0, slot_mid_secs / window_secs))

    # Centre of each third: morning=1/6, midday=1/2, afternoon=5/6
    preferred_center = {'morning': 1 / 6, 'midday': 0.5, 'afternoon': 5 / 6}.get(
        day_part or 'midday', 0.5
    )

    # Linear decay: 1.0 at the preferred centre, 0.0 at the opposite extreme.
    return max(0.0, 1.0 - abs(normalized - preferred_center) * 2)


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
    work_days_evaluated = 0
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
    # Helper: evaluate one calendar day, returning all conflict-free slots.
    # min_slot_start: when set, skip slots that begin before this UTC time
    #                 (used to avoid suggesting times earlier than the next
    #                 full hour when no target date is given).
    # -----------------------------------------------------------------------
    def _evaluate_day(day: datetime, min_slot_start: Optional[datetime] = None) -> List[ScoredSlot]:
        nonlocal work_days_with_sufficient_window

        utc_starts: List[datetime] = []
        utc_ends: List[datetime] = []
        for wh in work_hours_by_participant.values():
            tz = ZoneInfo(wh.get('timezone') or 'UTC')
            local_start = datetime(
                day.year, day.month, day.day,
                wh['start_hour'], wh['start_minute'], tzinfo=tz,
            )
            local_end = datetime(
                day.year, day.month, day.day,
                wh['end_hour'], wh['end_minute'], tzinfo=tz,
            )
            utc_starts.append(local_start.astimezone(timezone.utc).replace(tzinfo=None))
            utc_ends.append(local_end.astimezone(timezone.utc).replace(tzinfo=None))

        day_start = max(utc_starts)
        day_end = min(utc_ends)

        if (day_end - day_start).total_seconds() / 60 < meeting_duration_minutes:
            return []

        work_days_with_sufficient_window += 1

        slots: List[ScoredSlot] = []
        t = day_start
        # On today's date, don't suggest slots that have already started.
        if min_slot_start is not None and day.date() == min_slot_start.date():
            t = max(t, min_slot_start)

        while t + meeting_duration <= day_end:
            t_end = t + meeting_duration
            cand = TimeSlot(start=t, end=t_end)
            if not any(cand.overlaps(b) for b in all_busy_expanded):
                pos_score = _score_position(t, t_end, day_start, day_end, day_part)
                buf_min, buf_avg = _score_buffer_all_participants(
                    t, t_end, busy_by_participant_original, day_start, day_end,
                )
                slots.append(ScoredSlot(
                    start=t, end=t_end,
                    score=position_weight * pos_score + buffer_weight * buf_min,
                    position_score=pos_score,
                    buffer_score=buf_min,
                    buffer_score_avg=buf_avg,
                ))
            t += timedelta(minutes=step_minutes)

        return slots

    # -----------------------------------------------------------------------
    # Build the full list of candidate working days in the search window
    # -----------------------------------------------------------------------
    window_start = search_start.replace(hour=0, minute=0, second=0, microsecond=0)
    window_end = window_start + timedelta(weeks=max_weeks)

    all_working_days: List[datetime] = []
    cur = window_start
    while cur < window_end:
        if cur.weekday() in work_days:
            all_working_days.append(cur)
        cur += timedelta(days=1)

    # -----------------------------------------------------------------------
    # Search strategy
    #
    # With target dates → score every working day in the window. Proximity to
    #   the target date is the dominant factor (weight 0.7): the exact target
    #   date scores 1.0, one day off scores 0.5, two days off scores 0.33, etc.
    #   Position and buffer make up the remaining 0.3 weight so that within the
    #   same distance group better-timed slots still rank higher.
    # Both branches enforce a hard minimum: slots must start at least 1 hour
    # from now (UTC) so no past or imminent times are ever returned.
    # -----------------------------------------------------------------------
    PROXIMITY_WEIGHT = 0.7  # fraction of final score driven by date proximity

    # Hard limit: no slot may start within the next hour (naive UTC).
    earliest_slot_start = search_start + timedelta(hours=1)

    if target_dates:
        def _dist(d: datetime) -> int:
            return min(abs((d.date() - td).days) for td in target_dates)

        all_slots: List[ScoredSlot] = []
        for day in all_working_days:
            work_days_evaluated += 1
            dist = _dist(day)
            proximity = 1.0 / (1 + dist)
            for slot in _evaluate_day(day, min_slot_start=earliest_slot_start):
                internal = slot.score  # position_weight * pos + buffer_weight * buf
                slot.proximity_score = proximity
                slot.score = PROXIMITY_WEIGHT * proximity + (1 - PROXIMITY_WEIGHT) * internal
                all_slots.append(slot)

        if all_slots:
            all_slots.sort(key=lambda s: (-s.score, -s.buffer_score_avg))
            return {'slots': [s.to_dict() for s in all_slots[:top_n]]}

    else:
        all_slots: List[ScoredSlot] = []
        for day in all_working_days:
            work_days_evaluated += 1
            all_slots.extend(_evaluate_day(day, min_slot_start=earliest_slot_start))

        if all_slots:
            all_slots.sort(key=lambda s: (s.start.date(), -s.score, -s.buffer_score_avg))
            return {'slots': [s.to_dict() for s in all_slots[:top_n]]}

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
