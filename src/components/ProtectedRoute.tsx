import { ReactNode } from "react";

interface ProtectedRouteProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  authError?: string | null;
  onRetry?: () => void;
  fallback: ReactNode;
  children: ReactNode;
}

export function ProtectedRoute({ isAuthenticated, isLoading, authError, onRetry, fallback, children }: ProtectedRouteProps) {
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#07070F" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-jarvis-purple border-t-transparent" />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#07070F" }}>
        <div className="glass-surface max-w-md rounded-xl border border-border/40 p-6 text-center shadow-[0_0_40px_rgba(139,92,246,0.12)]">
          <p className="font-display text-xl font-semibold text-foreground">Authentication Unavailable</p>
          <p className="mt-3 font-display text-sm leading-6 text-muted-foreground">{authError}</p>
          <div className="mt-5 flex justify-center">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md px-4 py-2 font-display text-sm font-semibold text-foreground transition-opacity hover:opacity-95"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #3B82F6)" }}
            >
              Retry Session Check
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <>{fallback}</>;
  return <>{children}</>;
}
