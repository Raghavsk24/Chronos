# Chronos

Chronos is a smart group meeting scheduler. It connects to each participant's Google Calendar, analyses availability across the group, and ranks candidate time slots using a multi-factor scoring algorithm that accounts for time-of-day preference, calendar breathing room, and proximity to a target date.

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

Before you begin, make sure you have the following installed and set up:

- **Node.js 18+** - [nodejs.org](https://nodejs.org)
- **Python 3.11** - [python.org](https://python.org)
- **Firebase CLI** - install with `npm install -g firebase-tools`, then run `firebase login`
- **A Firebase project** with Auth, Firestore, Functions, and Hosting enabled - [console.firebase.google.com](https://console.firebase.google.com)
- **A Google Cloud OAuth 2.0 client** with the Google Calendar API enabled - [console.cloud.google.com](https://console.cloud.google.com)
- **A Resend account** for transactional email - [resend.com](https://resend.com)

---

## 1. Clone the repository

```bash
git clone https://github.com/your-username/chronos.git
cd chronos
```

---

## 2. Set up environment variables

### Frontend - `.env.local` (project root)

Copy the example file and fill in your Firebase project values:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in each value. You can find all of these in the [Firebase Console](https://console.firebase.google.com) under **Project Settings > Your Apps**:

```env
VITE_FIREBASE_API_KEY=your_firebase_api_key_here
VITE_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project_id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id
```

### Backend - `functions/.env`

Copy the example file and fill in your credentials:

```bash
cp functions/.env.example functions/.env
```

Open `functions/.env` and fill in each value:

```env
GOOGLE_CLIENT_ID=your_google_oauth_client_id_here
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret_here
RESEND_API_KEY=your_resend_api_key_here
REMINDER_FROM_EMAIL=your_verified_sender@example.com
```

**Where to get each value:**

| Variable | Where to find it |
|---|---|
| `GOOGLE_CLIENT_ID` | Google Cloud Console > APIs and Services > Credentials > your OAuth 2.0 client |
| `GOOGLE_CLIENT_SECRET` | Same page as above, click the client to reveal the secret |
| `RESEND_API_KEY` | Resend dashboard > API Keys |
| `REMINDER_FROM_EMAIL` | A sender address or domain you have verified in Resend |

---

## 3. Install frontend dependencies

```bash
npm install
```

---

## 4. Set up the Python virtual environment

**On macOS / Linux:**

```bash
cd functions
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

**On Windows:**

```bash
cd functions
python -m venv venv
venv\Scripts\pip install -r requirements.txt
cd ..
```

---

## 5. Connect Firebase to your project

```bash
firebase use --add
```

Select your Firebase project from the list. If you only have one project it will be selected automatically.

---

## 6. Run the app locally

Open two terminals in the project root and run each command in a separate terminal.

**Terminal 1 - frontend dev server:**

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`.

**Terminal 2 - Firebase Functions emulator:**

```bash
firebase emulators:start
```

The functions emulator runs at `http://localhost:5001`. The frontend is already configured to point to it automatically in development mode.

---

## Deploying to Production

### Deploy the frontend

```bash
npm run build
firebase deploy --only hosting
```

### Deploy Cloud Functions

Set your secrets first:

```bash
firebase functions:secrets:set GOOGLE_CLIENT_ID
firebase functions:secrets:set GOOGLE_CLIENT_SECRET
firebase functions:secrets:set RESEND_API_KEY
firebase functions:secrets:set REMINDER_FROM_EMAIL
```

Then deploy:

```bash
firebase deploy --only functions
```

### After deploying

- Add your production domain to **Google Cloud Console > APIs and Services > Credentials > Authorized redirect URIs**
- Add your production domain to **Firebase Console > Authentication > Settings > Authorized domains**
