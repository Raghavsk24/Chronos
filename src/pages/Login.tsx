import { Button } from '@/components/ui/button'

export default function Login() {
  const handleGoogleSignIn = () => {
    // TODO: wire up Firebase Google Auth
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm p-8 rounded-xl border bg-card shadow-sm flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Welcome to Chronos</h1>
          <p className="text-muted-foreground text-sm mt-1">Sign in to continue</p>
        </div>
        <Button className="w-full" onClick={handleGoogleSignIn}>
          Continue with Google
        </Button>
      </div>
    </div>
  )
}
