"""
Chronos Scheduling Algorithm
------------------------------
Finds and ranks available meeting slots across all participants,
respecting individual work hours, work days, buffer times, and calendar conflicts.
"""

from datetime import datetime, timedelta, time as dtime
from typing import List, Dict, Tuple
from dataclasses import dataclass


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
    work_start: dtime,
    work_end: dtime,
) -> float:
    """
    Score how close the slot's midpoint is to the shared workday midpoint.

    Uses the computed work_start (latest start across all participants) and
    work_end (earliest end across all participants) so the midpoint reflects
    the actual shared window — not any one person's schedule.

    1.0 = perfect centre, 0.0 = at the very edge of the work window.
    """
    ws = work_start.hour * 60 + work_start.minute
    we = work_end.hour * 60 + work_end.minute
    workday_midpoint = (ws + we) / 2

    slot_midpoint = (
        _minutes_since_midnight(slot_start) + _minutes_since_midnight(slot_end)
    ) / 2

    half_workday = (we - ws) / 2
    if half_workday == 0:
        return 1.0

    distance_from_centre = abs(slot_midpoint - workday_midpoint)
    return max(0.0, 1.0 - (distance_from_centre / half_workday))


def _score_buffer_for_participant(
    slot_start: datetime,
    slot_end: datetime,
    participant_slots: List[TimeSlot],
    work_start: dtime,
    work_end: dtime,
) -> float:
    """
    Score the breathing room around a slot from one participant's perspective.

    Uses the participant's original (un-expanded) busy slots so that buffer
    padding is not double-counted. Measures the gap between the candidate
    slot and the participant's nearest events on each side.
    """
    day = slot_start.date()
    day_start = datetime.combine(day, work_start)
    day_end = datetime.combine(day, work_end)

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
    work_start: dtime,
    work_end: dtime,
) -> Tuple[float, float]:
    """
    Calculate buffer scores for every participant, then return:
      - min_score: the lowest score (most constrained participant drives the result)
      - avg_score: the average score (used to break ties between slots with equal min scores)
    """
    if not busy_by_participant_original:
        return 1.0, 1.0

    scores = [
        _score_buffer_for_participant(slot_start, slot_end, slots, work_start, work_end)
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
    # Change 2: Compute intersection of work days across all participants
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

    # -----------------------------------------------------------------------
    # Change 3: Compute shared work window (latest start, earliest end)
    # -----------------------------------------------------------------------
    latest_start_minutes = max(
        h['start_hour'] * 60 + h['start_minute']
        for h in work_hours_by_participant.values()
    )
    earliest_end_minutes = min(
        h['end_hour'] * 60 + h['end_minute']
        for h in work_hours_by_participant.values()
    )

    shared_window_minutes = earliest_end_minutes - latest_start_minutes

    if shared_window_minutes < meeting_duration_minutes:
        return {
            'error': (
                f'The shared work hours window across all participants is only '
                f'{shared_window_minutes} minutes, which is shorter than the required '
                f'meeting duration of {meeting_duration_minutes} minutes. '
                f'Ask participants to review and update their work hour settings.'
            )
        }

    work_start = dtime(latest_start_minutes // 60, latest_start_minutes % 60)
    work_end = dtime(earliest_end_minutes // 60, earliest_end_minutes % 60)
    meeting_duration = timedelta(minutes=meeting_duration_minutes)

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
    # Change 1: Search week by week until slots are found or max_weeks reached
    # -----------------------------------------------------------------------
    for week in range(max_weeks):
        week_start = search_start + timedelta(weeks=week)
        week_end = week_start + timedelta(days=7)

        scored_slots: List[ScoredSlot] = []
        current_day = week_start.replace(hour=0, minute=0, second=0, microsecond=0)

        while current_day < week_end:

            # Change 2: Only process days in the common work days intersection
            if current_day.weekday() in work_days:
                day_start = datetime.combine(current_day.date(), work_start)
                day_end = datetime.combine(current_day.date(), work_end)
                candidate_start = day_start

                # Change 3: Inner loop bounded by shared work_start / work_end
                while candidate_start + meeting_duration <= day_end:
                    candidate_end = candidate_start + meeting_duration
                    candidate = TimeSlot(start=candidate_start, end=candidate_end)

                    # Change 4: Use pre-expanded busy list — no extra buffer needed here
                    has_conflict = any(
                        candidate.overlaps(busy) for busy in all_busy_expanded
                    )

                    if not has_conflict:
                        # Change 5: Position score uses the shared work_start / work_end
                        pos_score = _score_position(
                            candidate_start, candidate_end, work_start, work_end
                        )

                        # Change 6: Buffer score = minimum across all participants
                        #           Tiebreaker = average across all participants
                        buf_min, buf_avg = _score_buffer_all_participants(
                            candidate_start, candidate_end,
                            busy_by_participant_original,
                            work_start, work_end,
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
            # Change 7: Primary sort = date ascending (closest day first)
            #           Secondary sort = score descending (best score first within same day)
            #           Tertiary sort = avg buffer score descending (tiebreaker)
            scored_slots.sort(
                key=lambda s: (s.start.date(), -s.score, -s.buffer_score_avg)
            )
            return {'slots': [s.to_dict() for s in scored_slots[:top_n]]}

    return {
        'error': (
            f'No available meeting slots found in the next {max_weeks} weeks. '
            'Participants may need to clear some calendar time or adjust their work hour settings.'
        )
    }
