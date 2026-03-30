import { ReactNode } from "react";

interface ProtectedRouteProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  fallback: ReactNode;
  children: ReactNode;
}

export function ProtectedRoute({ isAuthenticated, isLoading, fallback, children }: ProtectedRouteProps) {
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#07070F" }}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-jarvis-purple border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return <>{fallback}</>;
  return <>{children}</>;
}
