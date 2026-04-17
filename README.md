# Chronos

Automated meeting scheduler for groups. Chronos connects to your team's Google Calendars and finds the best meeting slot for everyone — no back-and-forth required.

## Features

- Google OAuth sign-in
- Create lobbies and invite group members
- Automatic availability detection via Google Calendar API
- Host confirms the best slot, Chronos books it for everyone

## Tech Stack

- React 18 + Vite + TypeScript
- React Router v6
- Tailwind CSS + shadcn/ui
- Firebase (Auth, Firestore, Cloud Functions, Hosting)
- Google Calendar API v3

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Copy the example file and fill in your Firebase project credentials:

```bash
cp .env.example .env.local
```

Get the values from: Firebase Console → Your Project → Project Settings → Your Apps.

### 3. Run the development server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

## Project Structure

```
src/
  pages/
    Landing.tsx         # Public landing page
    Login.tsx           # Google sign-in page
    app/
      Dashboard.tsx     # Post-auth dashboard
      Lobbies.tsx       # Create and manage lobbies
      Calendar.tsx      # Calendar view of meetings
  components/
    AppLayout.tsx       # Sidebar nav for authenticated pages
    ui/                 # shadcn/ui components
  lib/
    firebase.ts         # Firebase app, auth, and Firestore instances
    utils.ts            # Shared utility functions
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

## Deployment

```bash
npm run build
firebase deploy
```
