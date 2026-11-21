# Chronos

Chronos finds a meeting time that works for everyone in a large group, then books it. A host creates a lobby, invites the people who need to meet, and starts scheduling for a meeting. Chronos reads each member's Google Calendar and work hours across the next month and suggests the five best open slots. When the host picks one, the meeting is added to every member's calendar and everyone is emailed a confirmation. Chronos won the ***2025 Congressional App Challenge***.

- **Live App:** https://usechronos.live
- **Congressional App Challenge Article:** https://hamadeh.house.gov/news/documentsingle.aspx?DocumentID=360

<br>

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/3a6a42e6-0604-4ba6-967d-6f895f166255" alt="Chronos screenshot 1" width="100%"></td>
    <td><img src="https://github.com/user-attachments/assets/04e67086-0890-4904-b0e1-68fc90415d07" alt="Chronos screenshot 2" width="100%"></td>
  </tr>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/ecc93f28-6baa-4770-a071-bca9b9a9e71b" alt="Chronos screenshot 3" width="100%"></td>
    <td><img src="https://github.com/user-attachments/assets/11cfa6d2-8915-4370-99d7-9a31145472f7" alt="Chronos screenshot 4" width="100%"></td>
  </tr>
</table>

## Tech Stack

<div align="center">

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white) ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css&logoColor=white) ![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)

![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E) ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white) ![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-000000?style=for-the-badge&logo=shadcnui&logoColor=white) ![React Router](https://img.shields.io/badge/React_Router-CA4245?style=for-the-badge&logo=react-router&logoColor=white) ![Node.js](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) ![npm](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)

![Python](https://img.shields.io/badge/Python-FFD43B?style=for-the-badge&logo=python&logoColor=blue) ![Firebase](https://img.shields.io/badge/firebase-ffca28?style=for-the-badge&logo=firebase&logoColor=black) ![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white) ![Sentry](https://img.shields.io/badge/Sentry-black?style=for-the-badge&logo=Sentry&logoColor=#362D59) ![PyPI](https://img.shields.io/badge/pypi-3775A9?style=for-the-badge&logo=pypi&logoColor=white) ![PyTest](https://img.shields.io/badge/PyTest-0A9EDC?style=for-the-badge&logo=pytest&logoColor=white)

![ESLint](https://img.shields.io/badge/eslint-3A33D1?style=for-the-badge&logo=eslint&logoColor=white) ![Git](https://img.shields.io/badge/GIT-E44C30?style=for-the-badge&logo=git&logoColor=white) ![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)  ![Claude](https://img.shields.io/badge/Claude-D97757?style=for-the-badge&logo=claude&logoColor=white)

</div>

## System Overview

```
 React + Vite web app  (Firebase Hosting)
 lobbies · meetings · calendar · settings
        │                        │
        │ Firebase Auth +        │ httpsCallable
        │ Firestore SDK          ▼
        │       ┌────────────────────────────────────────────────────┐
        │       │  Cloud Functions  (Python 3.11)                    │
        │       │    schedule_meeting ──► top 5 slots (algorithm.py) │
        │       │    book_meeting     ──► events + confirmation mail │
        │       │    cancel_booking   ──► removes events, notifies   │
        │       └────────────────────────────────────────────────────┘
        ▼               │                  │                   │
   Firestore ◄──────────┘                  ▼                   ▼
   users · lobbies · meetings    Google Calendar API       Resend API
                                 FreeBusy + events         booking emails
```

## How it Works

The scheduling logic lives in `functions/scheduling/algorithm.py` and runs inside the `schedule_meeting` Cloud Function.

### Step 1: Collect availability

When the host runs scheduling, the function refreshes each member's Google token if it has expired. It then asks the Google Calendar FreeBusy API for their busy intervals, from one hour from now to one month out. Only busy times are fetched, never event details.

### Step 2: Compute the shared work window

Each member stores work hours, a timezone, and work days. For every day in the search range, the algorithm:

- Keeps the day only if it is a work day for every member
- Converts each member's work hours to UTC using their timezone
- Takes the **latest start** and the **earliest end** as the shared window, and stops with an error if no day's window fits the meeting

### Step 3: Find candidate slots

The algorithm walks each shared window in 15-minute steps and keeps a slot only if it is free for every member, plus 30 extra minutes after the meeting when the host turns on extra buffer. With target dates, it searches outward from each target (the same day, then a day on either side, and so on) until it has 10 candidates per target. Without them, it collects 10 candidates from the earliest days.

### Step 4: Score each slot

Every candidate gets three scores between 0 and 1, combined with fixed weights:

**Proximity:** 1 on a target date, halving with each day away. Without target dates every slot gets 1.

**Position:** the shared window splits into morning, afternoon, and evening thirds. The host's preferred third scores 1, a neighboring third 0.5, and the opposite third 0.25.

**Buffer:** the slot is widened by 5, 10, 15, 30, 45, and 60 minutes in turn until it hits a conflict. Clearing all six scores 1, and each step fewer scores less. A slot that clears none is dropped.

```python
score = 0.5 * proximity_score + 0.35 * position_score + 0.15 * buffer_score
```

### Step 5: Return ranked slots

Candidates are sorted by score, with earlier start times breaking ties, and the top 5 go back to the host. Each slot arrives with its three component scores, so the host sees why it ranked where it did. If nothing qualifies, the host gets a clear message to free up calendar time or change the target date, instead of an empty list.

### Step 6: Book the meeting

When the host picks a slot, `book_meeting` creates the event on every member's Google Calendar and saves the event IDs, so a reschedule or cancellation can remove them later. Each member is then emailed a confirmation through Resend.

## Getting Started

**1. Set up the accounts and tools**

You need Node.js, Python 3.11, and the Firebase CLI (`npm install -g firebase-tools`). Chronos also depends on four outside services: a Firebase project with Auth, Firestore, Functions, and Hosting enabled; a Google Cloud OAuth client with the Google Calendar API enabled and `http://localhost:5173/auth/google/callback` as a redirect URI; a Resend account with a verified sending domain; and, optionally, a Sentry project for error monitoring.

**2. Clone the repository**

```bash
git clone https://github.com/Raghavsk24/Chronos.git
cd Chronos
```

**3. Add your environment variables**

Copy both templates and fill in the Firebase web config, the OAuth client, and your Resend key. Also add `VITE_GOOGLE_CLIENT_ID` to `.env.local`, since the template leaves it out.

*macOS / Linux:*

```bash
cp .env.example .env.local
cp functions/.env.example functions/.env
```

*Windows:*

```powershell
copy .env.example .env.local
copy functions\.env.example functions\.env
```

The two files use these names:

```env
# .env.local
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_CLIENT_ID=
VITE_SENTRY_DSN=

# functions/.env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
REMINDER_FROM_EMAIL=
```

**4. Install dependencies**

*macOS / Linux:*

```bash
npm install
cd functions
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..
```

*Windows:*

```powershell
npm install
cd functions
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

**5. Connect Firebase and deploy the backend**

The web app calls the deployed Cloud Functions even when it runs locally, so deploy the functions and Firestore rules once before the first run.

```bash
firebase login
firebase use --add
firebase deploy --only functions,firestore
```

**6. Run the app**

*Local:*

```bash
npm run dev
```

*Production:*

```bash
npm run build
firebase deploy --only hosting,functions,firestore
```

## License
MIT
