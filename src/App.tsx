import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'

const Landing = lazy(() => import('@/pages/Landing'))
const Login = lazy(() => import('@/pages/Login'))
const AuthAction = lazy(() => import('@/pages/AuthAction'))
const Onboarding = lazy(() => import('@/pages/Onboarding'))
const Join = lazy(() => import('@/pages/Join'))
const GoogleCalendarCallback = lazy(() => import('@/pages/GoogleCalendarCallback'))
const ProtectedRoute = lazy(() => import('@/components/ProtectedRoute'))
const AppLayout = lazy(() => import('@/components/AppLayout'))
const Dashboard = lazy(() => import('@/pages/app/Dashboard'))
const Lobbies = lazy(() => import('@/pages/app/Lobbies'))
const LobbyDetail = lazy(() => import('@/pages/app/LobbyDetail'))
const MeetingDetail = lazy(() => import('@/pages/app/MeetingDetail'))
const Settings = lazy(() => import('@/pages/app/Settings'))

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  )
}

function AppSectionFallback() {
  return (
    <div className="h-[calc(100vh-3.5rem)] flex items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="top-right" closeButton />
      <Routes>
        <Route path="/" element={<Suspense fallback={<PageFallback />}><Landing /></Suspense>} />
        <Route path="/login" element={<Suspense fallback={<PageFallback />}><Login /></Suspense>} />
        <Route path="/auth/action" element={<Suspense fallback={<PageFallback />}><AuthAction /></Suspense>} />
        <Route path="/onboarding" element={<Suspense fallback={<PageFallback />}><Onboarding /></Suspense>} />
        <Route path="/join/:id" element={<Suspense fallback={<PageFallback />}><Join /></Suspense>} />
        <Route path="/auth/google/callback" element={<Suspense fallback={<PageFallback />}><GoogleCalendarCallback /></Suspense>} />
        <Route
          path="/app"
          element={
            <Suspense fallback={<PageFallback />}>
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            </Suspense>
          }
        >
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Suspense fallback={<AppSectionFallback />}><Dashboard /></Suspense>} />
          <Route path="lobbies" element={<Suspense fallback={<AppSectionFallback />}><Lobbies /></Suspense>} />
          <Route path="lobbies/:id" element={<Suspense fallback={<AppSectionFallback />}><LobbyDetail /></Suspense>} />
          <Route path="lobbies/:lobbyId/meetings/:meetingId" element={<Suspense fallback={<AppSectionFallback />}><MeetingDetail /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<AppSectionFallback />}><Settings /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
