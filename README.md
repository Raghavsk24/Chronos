# Chronos

Chronos is a smart group meeting scheduler. It connects to each participant's Google Calendar, analyses availability across the group, and ranks candidate time slots using a multi-factor scoring algorithm that accounts for time-of-day preference, calendar breathing room, and proximity to a target date.

**Live:** [chronos-ba69a.web.app](https://chronos-ba69a.web.app) *(custom domain coming soon)*

<p>
  <img width=49% height=49% alt="Screenshot 2026-04-21 113730" src="https://github.com/user-attachments/assets/fcf5ffe3-7fe2-4054-a509-18a1ecb138b8" />
  <img width=49% height=49% alt="Screenshot 2026-04-21 113730" src="https://github.com/user-attachments/assets/04e67086-0890-4904-b0e1-68fc90415d07" />
</p>
<p>
  <img width=49% height=49% alt="Screenshot 2026-04-21 130909" src="https://github.com/user-attachments/assets/ecc93f28-6baa-4770-a071-bca9b9a9e71b" />
  <img width=49% height=49% alt="Screenshot 2026-04-21 113657" src="https://github.com/user-attachments/assets/01363e62-dc51-4dfc-9060-af9fde29226f" />
</p>

## Tech Stack

### Frontend

![React](https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_v4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?style=for-the-badge&logo=shadcnui&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-443E38?style=for-the-badge&logo=react&logoColor=white)
![date-fns](https://img.shields.io/badge/date--fns-770C56?style=for-the-badge&logo=npm&logoColor=white)
![Sonner](https://img.shields.io/badge/Sonner-000000?style=for-the-badge&logo=npm&logoColor=white)
![Sentry](https://img.shields.io/badge/Sentry-362D59?style=for-the-badge&logo=sentry&logoColor=white)

### Backend

![Python](https://img.shields.io/badge/Python_3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Firebase Functions](https://img.shields.io/badge/Firebase_Functions-FF6F00?style=for-the-badge&logo=firebase&logoColor=white)
![Google Calendar API](https://img.shields.io/badge/Google_Calendar_API-4285F4?style=for-the-badge&logo=google-calendar&logoColor=white)
![Resend](https://img.shields.io/badge/Resend-000000?style=for-the-badge&logo=mail&logoColor=white)
![Sentry](https://img.shields.io/badge/Sentry-362D59?style=for-the-badge&logo=sentry&logoColor=white)

### Infrastructure

![Firebase Auth](https://img.shields.io/badge/Firebase_Auth-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Firestore](https://img.shields.io/badge/Firestore-FF6F00?style=for-the-badge&logo=firebase&logoColor=white)
![Firebase Hosting](https://img.shields.io/badge/Firebase_Hosting-FFA000?style=for-the-badge&logo=firebase&logoColor=white)
![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white)


## Scheduling Algorithm

The algorithm lives in `functions/scheduling/algorithm.py` and runs inside the `schedule_meeting` Cloud Function.

### Step 1: Collect availability

For each participant with a connected Google Calendar, the backend calls the Google Calendar FreeBusy API to fetch their busy intervals over the next 4 weeks. Expired access tokens are automatically refreshed using the stored refresh token before every scheduling run.

### Step 2: Compute the shared work window

Each participant stores their work hours (start/end time + timezone) and work days in Firestore. The algorithm:

- Converts every participant's work hours to UTC using their timezone
- Takes the **latest start** and **earliest end** across all participants as the shared window for each day
- Takes the **intersection of work days** so only days everyone works are considered

### Step 3: Find candidate slots

For each valid working day, the algorithm steps through the shared window in 15-minute increments. Each candidate slot is checked against all participants' busy intervals, expanded by each person's configured buffer time (default 15 minutes). A slot is only kept if it is conflict-free for everyone and starts at least 1 hour from now.

### Step 4: Score each slot

Every passing slot receives three component scores:

**Position score (15% of total score):** The work window is divided into three equal thirds: morning, midday, and afternoon. The score peaks at the centre of the preferred third and decays linearly toward 0 at the opposite end.

**Buffer score (15% of total score):** Measures how much free time surrounds the slot for each participant. The gap between the slot and the nearest adjacent event on each side is measured and normalised to 0–1 (120 minutes of free time = full score of 1.0).

**Proximity score (70% of total score):** When the user specifies a target date, every slot receives a proximity score calculated as:

```
proximity = 1 / (1 + days_away_from_target)
```

This gives the exact target date a score of 1.0, one day off a score of 0.5, two days off 0.33, and so on.

**Final score**

```
score = 0.7 * proximity_score + 0.15 * position_score + 0.15 * buffer_score
```

### Step 5: Return ranked slots

Slots are sorted by final score (descending), with the buffer average as a tiebreaker. Up to 20 slots are returned to the frontend where they are displayed with a score breakdown tooltip on each slot and a "Show more" toggle after the first five.


## Getting Started

### Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Python 3.11** — [python.org](https://python.org)
- **Firebase CLI** — `npm install -g firebase-tools`, then `firebase login`
- **Firebase project** with Auth, Firestore, Functions, and Hosting enabled — [console.firebase.google.com](https://console.firebase.google.com)
- **Google Cloud OAuth 2.0 client** with the Google Calendar API enabled — [console.cloud.google.com](https://console.cloud.google.com)
- **Resend account** with a verified sending domain — [resend.com](https://resend.com)
- **Sentry account** (optional, for error monitoring) — [sentry.io](https://sentry.io)

---

### 1. Clone the repository

```bash
git clone https://github.com/Raghavsk24/Chronos.git
cd Chronos
```

---

### 2. Frontend environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Optional — enables Sentry error monitoring in the browser
VITE_SENTRY_DSN=
```

---

### 3. Backend environment variables

Create `functions/.env`:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
REMINDER_FROM_EMAIL=you@yourdomain.com

# Optional — enables Sentry error monitoring in Cloud Functions
SENTRY_DSN=
```

---

### 4. Install frontend dependencies

```bash
npm install
```

---

### 5. Set up the Python virtual environment

**macOS / Linux:**

```bash
cd functions
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

**Windows:**

```bash
cd functions
python -m venv venv
venv\Scripts\pip install -r requirements.txt
cd ..
```

---

### 6. Connect the Firebase project

```bash
firebase use --add
```

Select your Firebase project from the list.

---

### 7. Run locally

```bash
npm run dev
```

The app connects directly to your Firebase project (Firestore, Auth, and deployed Cloud Functions). No emulator needed.

---

### 8. Deploy to production

```bash
firebase deploy --only hosting,functions,firestore
```
