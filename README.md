# Chronos

Automatatic calendar scheduling for large groups

## Backend reminder emails

Chronos now includes a scheduled Cloud Function that sends meeting reminder emails:

- 24-hour reminders for users who enabled `emailReminderTwentyFourHours`
- 1-hour reminders for users who enabled `emailReminderOneHour`

Function name:

- `send_meeting_email_reminders` (runs every 15 minutes, UTC)

The reminder sender uses Resend API. Set these environment variables for your Functions runtime:

- `RESEND_API_KEY`
- `REMINDER_FROM_EMAIL`

If either variable is missing, the reminder job skips sending and logs skipped counts.

## Backend tests

Run all backend tests:

```bash
cd functions
python -m pytest -v
```

The suite includes integration tests for booking behavior and mocked Google Calendar responses (`200`, `401`, `500`).