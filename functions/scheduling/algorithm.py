"""Chronos scheduling algorithm implementation based on product requirements."""

from dataclasses import dataclass
from datetime import date as ddate
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo
from zoneinfo import ZoneInfoNotFoundError


INTERVAL_MINUTES = 15
DEFAULT_TOP_N = 5
MAX_CANDIDATES_PER_TARGET = 10
BUFFER_INTERVALS_MINUTES = [5, 10, 15, 30, 45, 60]
BUFFER_SCORE_BY_PASS_COUNT = {
    0: 0.0,
    1: 0.015625,
    2: 0.03125,
    3: 0.0625,
    4: 0.125,
    5: 0.25,
    6: 1.0,
}


@dataclass(frozen=True)
class TimeSlot:
    start: datetime
    end: datetime

    def overlaps(self, other: "TimeSlot") -> bool:
        return self.start < other.end and self.end > other.start


@dataclass
class CandidateSlot:
    start: datetime
    end: datetime
    day_start: datetime
    day_end: datetime
    proximity_score: Optional[float]
    position_score: float
    buffer_score: float
    score: float

    def to_dict(self) -> dict:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "score": round(self.score, 6),
            "proximity_score": (
                round(self.proximity_score, 6) if self.proximity_score is not None else None
            ),
            "position_score": round(self.position_score, 6),
            "buffer_score": round(self.buffer_score, 6),
            # Kept for frontend compatibility even though the new algorithm uses one buffer score.
            "buffer_score_avg": round(self.buffer_score, 6),
        }


def _parse_iso_to_utc_naive(iso_value: str) -> datetime:
    normalized = iso_value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _round_up_to_interval(dt: datetime, minutes: int) -> datetime:
    seconds = dt.minute * 60 + dt.second
    interval_seconds = minutes * 60
    remainder = seconds % interval_seconds
    if remainder == 0 and dt.microsecond == 0:
        return dt.replace(second=0, microsecond=0)
    delta_seconds = interval_seconds - remainder
    if dt.microsecond:
        delta_seconds -= 1
    rounded = dt + timedelta(seconds=delta_seconds)
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


def _is_free_for_all(
    start: datetime,
    end: datetime,
    busy_by_participant: Dict[str, List[TimeSlot]],
) -> bool:
    candidate = TimeSlot(start=start, end=end)
    for slots in busy_by_participant.values():
        for busy in slots:
            if candidate.overlaps(busy):
                return False
    return True


def _compute_position_score(
    slot_start: datetime,
    slot_end: datetime,
    day_start: datetime,
    day_end: datetime,
    host_day_part: str,
) -> float:
    window_seconds = (day_end - day_start).total_seconds()
    if window_seconds <= 0:
        return 1.0

    one_third = window_seconds / 3.0
    midpoint = slot_start + (slot_end - slot_start) / 2
    midpoint_seconds = (midpoint - day_start).total_seconds()

    if midpoint_seconds < one_third:
        slot_position = "morning"
    elif midpoint_seconds < 2 * one_third:
        slot_position = "afternoon"
    else:
        slot_position = "evening"

    order = {"morning": 0, "afternoon": 1, "evening": 2}
    distance = abs(order[slot_position] - order[host_day_part])
    if distance == 0:
        return 1.0
    if distance == 1:
        return 0.5
    return 0.25


def _compute_buffer_score(
    slot_start: datetime,
    slot_end: datetime,
    busy_by_participant: Dict[str, List[TimeSlot]],
) -> float:
    passed = 0
    for minutes in BUFFER_INTERVALS_MINUTES:
        expanded_start = slot_start - timedelta(minutes=minutes)
        expanded_end = slot_end + timedelta(minutes=minutes)
        if _is_free_for_all(expanded_start, expanded_end, busy_by_participant):
            passed += 1
            continue
        break

    return BUFFER_SCORE_BY_PASS_COUNT[passed]


def _compute_proximity_score(slot_date: ddate, target_dates: List[ddate]) -> Optional[float]:
    if not target_dates:
        return None
    diff_days = min(abs((slot_date - target).days) for target in target_dates)
    return 1 / (2 ** diff_days)


def _shared_window_for_day(
    day: datetime,
    work_hours_by_participant: Dict[str, dict],
) -> Optional[tuple[datetime, datetime]]:
    starts: List[datetime] = []
    ends: List[datetime] = []

    for participant_hours in work_hours_by_participant.values():
        timezone_name = participant_hours.get("timezone") or "UTC"
        if timezone_name in {"UTC", "Etc/UTC", "GMT"}:
            tz = timezone.utc
        else:
            try:
                tz = ZoneInfo(timezone_name)
            except ZoneInfoNotFoundError:
                tz = timezone.utc
        local_start = datetime(
            day.year,
            day.month,
            day.day,
            participant_hours["start_hour"],
            participant_hours["start_minute"],
            tzinfo=tz,
        )
        local_end = datetime(
            day.year,
            day.month,
            day.day,
            participant_hours["end_hour"],
            participant_hours["end_minute"],
            tzinfo=tz,
        )

        start_utc = local_start.astimezone(timezone.utc).replace(tzinfo=None)
        end_utc = local_end.astimezone(timezone.utc).replace(tzinfo=None)
        starts.append(start_utc)
        ends.append(end_utc)

    if not starts or not ends:
        return None

    shared_start = max(starts)
    shared_end = min(ends)
    if shared_end <= shared_start:
        return None

    return shared_start, shared_end


def _generate_slots_for_day(
    day: datetime,
    min_start: datetime,
    meeting_duration_minutes: int,
    includes_extra_buffer: bool,
    shared_day_window: tuple[datetime, datetime],
    busy_by_participant: Dict[str, List[TimeSlot]],
) -> List[tuple[datetime, datetime]]:
    shared_start, shared_end = shared_day_window

    slot_start = max(shared_start, min_start)
    slot_start = _round_up_to_interval(slot_start, INTERVAL_MINUTES)

    slots: List[tuple[datetime, datetime]] = []
    duration = timedelta(minutes=meeting_duration_minutes)
    extra = timedelta(minutes=30) if includes_extra_buffer else timedelta(0)

    while True:
        slot_end = slot_start + duration
        availability_end = slot_end + extra

        if availability_end > shared_end:
            break

        if _is_free_for_all(slot_start, availability_end, busy_by_participant):
            slots.append((slot_start, slot_end))

        slot_start += timedelta(minutes=INTERVAL_MINUTES)

    return slots


def _target_search_days(
    target: ddate,
    baseline: datetime,
    horizon_end: datetime,
) -> List[ddate]:
    results: List[ddate] = []
    max_distance = (horizon_end.date() - baseline.date()).days

    for distance in range(max_distance + 1):
        if distance == 0:
            candidate = target
            if baseline.date() <= candidate <= horizon_end.date():
                results.append(candidate)
            continue

        before = target - timedelta(days=distance)
        after = target + timedelta(days=distance)

        if baseline.date() <= before <= horizon_end.date():
            results.append(before)
        if baseline.date() <= after <= horizon_end.date():
            results.append(after)

    return results


def _build_candidate(
    start: datetime,
    end: datetime,
    day_start: datetime,
    day_end: datetime,
    busy_by_participant: Dict[str, List[TimeSlot]],
    host_day_part: str,
    target_dates: List[ddate],
) -> CandidateSlot:
    proximity_score = _compute_proximity_score(start.date(), target_dates)
    if proximity_score is None:
        proximity_score = 1.0

    position_score = _compute_position_score(start, end, day_start, day_end, host_day_part)
    buffer_score = _compute_buffer_score(start, end, busy_by_participant)

    score = 0.5 * proximity_score + 0.35 * position_score + 0.15 * buffer_score
    return CandidateSlot(
        start=start,
        end=end,
        day_start=day_start,
        day_end=day_end,
        proximity_score=_compute_proximity_score(start.date(), target_dates),
        position_score=position_score,
        buffer_score=buffer_score,
        score=score,
    )


def find_meeting_slots(
    busy_slots_by_participant: Dict[str, List[dict]],
    buffer_by_participant: Dict[str, int],
    work_hours_by_participant: Dict[str, dict],
    work_days_by_participant: Dict[str, List[int]],
    meeting_duration_minutes: int,
    search_start: datetime,
    max_weeks: int = 4,
    step_minutes: int = INTERVAL_MINUTES,
    position_weight: float = 0.35,
    buffer_weight: float = 0.15,
    top_n: int = DEFAULT_TOP_N,
    preferences: Optional[dict] = None,
) -> dict:
    del max_weeks, step_minutes, position_weight, buffer_weight, buffer_by_participant

    if not work_days_by_participant or not work_hours_by_participant:
        return {"error": "No participants have valid scheduling settings."}

    preferences = preferences or {}
    host_day_part_raw = str(preferences.get("dayPart") or "afternoon").lower()
    day_part_alias = {"midday": "afternoon"}
    host_day_part = day_part_alias.get(host_day_part_raw, host_day_part_raw)
    if host_day_part not in {"morning", "afternoon", "evening"}:
        host_day_part = "afternoon"

    extra_buffer_enabled = bool(preferences.get("extraBuffer"))
    target_dates: List[ddate] = []
    for raw_date in preferences.get("targetDates") or []:
        try:
            target_dates.append(ddate.fromisoformat(raw_date))
        except ValueError:
            continue

    participant_ids = list(work_days_by_participant.keys())
    shared_work_days = set(work_days_by_participant[participant_ids[0]])
    for participant_days in work_days_by_participant.values():
        shared_work_days &= set(participant_days)

    if not shared_work_days:
        return {
            "error": (
                "No shared work days exist across all participants. "
                "At least one common work day is required."
            )
        }

    baseline = _round_up_to_interval(search_start + timedelta(hours=1), INTERVAL_MINUTES)
    horizon_end = _add_one_month(search_start)

    parsed_busy: Dict[str, List[TimeSlot]] = {}
    for uid, busy_slots in busy_slots_by_participant.items():
        parsed = [
            TimeSlot(
                start=_parse_iso_to_utc_naive(slot["start"]),
                end=_parse_iso_to_utc_naive(slot["end"]),
            )
            for slot in busy_slots
        ]
        parsed.sort(key=lambda slot: slot.start)
        parsed_busy[uid] = parsed

    first_day = baseline.replace(hour=0, minute=0, second=0, microsecond=0)
    last_day = horizon_end.replace(hour=0, minute=0, second=0, microsecond=0)
    daily_windows: Dict[ddate, tuple[datetime, datetime]] = {}

    cursor = first_day
    has_duration_sized_window = False
    while cursor <= last_day:
        if cursor.weekday() in shared_work_days:
            window = _shared_window_for_day(cursor, work_hours_by_participant)
            if window:
                window_start, window_end = window
                if (window_end - window_start) >= timedelta(minutes=meeting_duration_minutes):
                    has_duration_sized_window = True
                daily_windows[cursor.date()] = window
        cursor += timedelta(days=1)

    if not has_duration_sized_window:
        return {
            "error": (
                "Meeting duration is longer than the shared work window across participants. "
                "Please reduce duration or update work hours."
            )
        }

    candidates: Dict[tuple[str, str], CandidateSlot] = {}

    def add_day_slots(day_date: ddate) -> int:
        day_window = daily_windows.get(day_date)
        if not day_window:
            return 0

        min_start = baseline
        if day_date > baseline.date():
            min_start = datetime(day_date.year, day_date.month, day_date.day)

        generated = _generate_slots_for_day(
            day=datetime(day_date.year, day_date.month, day_date.day),
            min_start=min_start,
            meeting_duration_minutes=meeting_duration_minutes,
            includes_extra_buffer=extra_buffer_enabled,
            shared_day_window=day_window,
            busy_by_participant=parsed_busy,
        )

        added = 0
        for start, end in generated:
            slot = _build_candidate(
                start=start,
                end=end,
                day_start=day_window[0],
                day_end=day_window[1],
                busy_by_participant=parsed_busy,
                host_day_part=host_day_part,
                target_dates=target_dates,
            )

            if slot.buffer_score <= 0:
                continue

            key = (slot.start.isoformat(), slot.end.isoformat())
            existing = candidates.get(key)
            if existing is None or slot.score > existing.score:
                candidates[key] = slot
            added += 1

        return added

    if target_dates:
        for target in target_dates:
            count_for_target = 0
            for day_date in _target_search_days(target, baseline, horizon_end):
                if day_date not in daily_windows:
                    continue
                count_for_target += add_day_slots(day_date)
                if count_for_target >= MAX_CANDIDATES_PER_TARGET:
                    break
    else:
        ordered_days = sorted(daily_windows.keys())
        count = 0
        for day_date in ordered_days:
            count += add_day_slots(day_date)
            if count >= MAX_CANDIDATES_PER_TARGET:
                break

    ranked = sorted(
        candidates.values(),
        key=lambda slot: (-slot.score, slot.start),
    )

    if not ranked:
        return {
            "error": (
                "Sorry we were unable to find any available times to host this meeting for your group. "
                "We searched up to month ahead from today. Please free up time on your calendars "
                "or change the target date and try again."
            )
        }

    return {"slots": [slot.to_dict() for slot in ranked[:top_n]]}
