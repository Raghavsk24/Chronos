import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import Landing from '@/pages/Landing'
import Login from '@/pages/Login'
import Onboarding from '@/pages/Onboarding'
import AppLayout from '@/components/AppLayout'
import Dashboard from '@/pages/app/Dashboard'
import Lobbies from '@/pages/app/Lobbies'
import ProtectedRoute from '@/components/ProtectedRoute'
import LobbyDetail from '@/pages/app/LobbyDetail'
import MeetingDetail from '@/pages/app/MeetingDetail'
import Settings from '@/pages/app/Settings'
import Join from '@/pages/Join'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="top-right" closeButton />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/join/:id" element={<Join />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/app/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="lobbies" element={<Lobbies />} />
          <Route path="lobbies/:id" element={<LobbyDetail />} />
          <Route path="lobbies/:lobbyId/meetings/:meetingId" element={<MeetingDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
