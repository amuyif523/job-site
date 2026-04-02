import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, apiGetMe, apiLogout, UserData } from "@/lib/api";

type AuthContextValue = {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  authError: string | null;
  user: UserData | null;
  isLoggingOut: boolean;
  setAuthenticatedUser: (userData: UserData) => void;
  retryAuth: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [user, setUser] = useState<UserData | null>(null);

  const hydrateAuth = useCallback(
    async (isCancelled?: () => boolean) => {
      setIsAuthLoading(true);
      setAuthError(null);
      try {
        const me = await apiGetMe();
        if (!isCancelled?.()) {
          setUser(me);
          setIsAuthenticated(true);
        }
      } catch (error) {
        if (!isCancelled?.()) {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            setUser(null);
            setIsAuthenticated(false);
            setAuthError(null);
          } else {
            setAuthError("We couldn't verify your session right now. Check your connection and try again.");
          }
        }
      } finally {
        if (!isCancelled?.()) {
          setIsAuthLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void hydrateAuth(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [hydrateAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isAuthLoading,
      authError,
      user,
      isLoggingOut,
      setAuthenticatedUser: (userData: UserData) => {
        setUser(userData);
        setIsAuthenticated(true);
        setIsAuthLoading(false);
        setAuthError(null);
      },
      retryAuth: async () => {
        await hydrateAuth();
      },
      logout: async () => {
        setIsLoggingOut(true);
        setAuthError(null);
        try {
          await apiLogout();
          setUser(null);
          setIsAuthenticated(false);
          setIsAuthLoading(false);
        } finally {
          setIsLoggingOut(false);
        }
      },
    }),
    [authError, hydrateAuth, isAuthenticated, isAuthLoading, isLoggingOut, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
