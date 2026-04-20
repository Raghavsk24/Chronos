# Chronos

Chronos is a smart meeting scheduler that finds the best time for everyone. It connects to each participant's Google Calendar, analyses availability across the group, and ranks candidate slots using a multi-factor scoring algorithm that accounts for time-of-day preference, calendar breathing room, and proximity to a target date.

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 19 + TypeScript | UI framework |
| Vite | Build tool and dev server |
| React Router v7 | Client-side routing |
| Tailwind CSS v4 | Styling |
| shadcn/ui | Component library |
| Zustand | Global auth state |
| date-fns | Date formatting and arithmetic |
| Sonner | Toast notifications |
| Lucide React | Icons |
| FullCalendar | Calendar view |

### Backend
| Technology | Purpose |
|---|---|
| Python 3.11 | Cloud Functions runtime |
| Firebase Functions | Callable HTTPS endpoints |
| Firebase Admin SDK | Server-side Firestore access |
| Google Calendar API | FreeBusy queries and event creation |
| Resend | Transactional email (confirmations, reminders, cancellations) |
| tzdata + zoneinfo | IANA timezone database for cross-timezone scheduling |

### Infrastructure
| Technology | Purpose |
|---|---|
| Firebase Auth | Google OAuth sign-in |
| Firestore | Database for lobbies, meetings, and user settings |
| Firebase Hosting | Static frontend deployment |
| Firebase Emulator Suite | Local development |

---

## Scheduling Algorithm

The algorithm lives in `functions/scheduling/algorithm.py` and runs inside the `schedule_meeting` Cloud Function.

### Step 1 - Collect availability

For each participant with a connected Google Calendar, the backend calls the Google Calendar FreeBusy API to fetch their busy intervals over the next 4 weeks. Expired access tokens are automatically refreshed using the stored refresh token.

### Step 2 - Compute the shared work window

Each participant stores their work hours (start/end time + timezone) and work days in Firestore. The algorithm:

- Converts every participant's work hours to UTC using their timezone
- Takes the **latest start** and **earliest end** across all participants as the shared window for each day
- Takes the **intersection of work days** so only days everyone works are considered

### Step 3 - Generate candidate slots

For each valid working day, the algorithm steps through the shared window in 15-minute increments. Each candidate slot is checked against all participants' busy intervals, expanded by each person's configured buffer time (default 15 minutes). A slot is only kept if it is conflict-free for everyone and starts at least 1 hour from now.

### Step 4 - Score each slot

Every passing slot receives three component scores:

**Position score (15% of total)**
The work window is divided into three equal thirds: morning, midday, and afternoon. The score peaks at the centre of the preferred third and decays linearly toward 0 at the opposite end. Scoring uses timedelta arithmetic from the window start rather than clock minutes, so it is correct even when work hours cross midnight UTC (common for US timezones).

**Buffer score (15% of total)**
Measures how much breathing room surrounds the slot for each participant. The gap between the slot and the nearest adjacent event on each side is measured and normalised to 0-1 (120+ minutes of clear space = full score). The minimum score across all participants drives the final buffer score, with the average used as a tiebreaker.

**Proximity score (70% of total, only when a target date is set)**
When the user specifies a target date, every slot receives a proximity score calculated as:

```
proximity = 1 / (1 + days_away_from_target)
```

This gives the exact target date a score of 1.0, one day off a score of 0.5, two days off 0.33, and so on. Proximity carries 70% of the final score so target-date slots reliably outrank slots on other days.

**Final score**

Without a target date:
```
score = 0.5 * position_score + 0.5 * buffer_score
```

With a target date:
```
score = 0.7 * proximity_score + 0.15 * position_score + 0.15 * buffer_score
```

### Step 5 - Return top results

Slots are sorted by final score (descending), with the buffer average as a tiebreaker. The top 5 are returned to the frontend where they are displayed with a score breakdown tooltip on each slot.

---

## Prerequisites

- Node.js 18+
- Python 3.11
- Firebase CLI (`npm install -g firebase-tools`)
- A Firebase project with Auth, Firestore, Functions, and Hosting enabled
- A Google Cloud OAuth 2.0 client ID with the Calendar API enabled
- A Resend account for transactional email

---

## Environment Setup

### Frontend - `src/.env.local`

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

### Backend - `functions/.env`

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
REMINDER_FROM_EMAIL=
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` come from your OAuth 2.0 client in the Google Cloud Console under APIs and Services > Credentials. `RESEND_API_KEY` comes from your Resend dashboard. `REMINDER_FROM_EMAIL` must be a verified sender address or domain on Resend.

---

## Running Locally

### 1. Install frontend dependencies

```bash
npm install
```

### 2. Set up the Python virtual environment

```bash
cd functions
python -m venv venv
venv/Scripts/pip install -r requirements.txt
cd ..
```

### 3. Start the frontend dev server

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`.

### 4. Start the Firebase Functions emulator

In a separate terminal:

```bash
firebase emulators:start
```

The functions emulator runs at `http://localhost:5001`. The frontend is already configured to point to it in development mode.

---

## Deploying to Production

### Deploy the frontend

```bash
npm run build
firebase deploy --only hosting
```

### Deploy Cloud Functions

```bash
firebase deploy --only functions
```

Set your environment variables in the Firebase console under Functions > Configuration, or use the Firebase CLI:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_ID
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set REMINDER_FROM_EMAIL
```

