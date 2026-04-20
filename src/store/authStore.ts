import { create } from 'zustand'
import { type User } from 'firebase/auth'

interface AuthState {
  user: User | null
  onboardingComplete: boolean | null
  setUser: (user: User | null) => void
  setOnboardingComplete: (v: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  onboardingComplete: null,
  setUser: (user) => set({ user }),
  setOnboardingComplete: (onboardingComplete) => set({ onboardingComplete }),
}))
