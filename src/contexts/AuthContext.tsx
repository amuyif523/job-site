import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGetMe, clearToken, getToken, UserData } from "@/lib/api";

type AuthContextValue = {
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  user: UserData | null;
  setAuthenticatedUser: (userData: UserData) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [user, setUser] = useState<UserData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const hydrateAuth = async () => {
      const token = getToken();
      if (!token) {
        if (!cancelled) {
          setIsAuthenticated(false);
          setUser(null);
          setIsAuthLoading(false);
        }
        return;
      }

      try {
        const me = await apiGetMe();
        if (!cancelled) {
          setUser(me);
          setIsAuthenticated(true);
        }
      } catch {
        clearToken();
        if (!cancelled) {
          setUser(null);
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setIsAuthLoading(false);
        }
      }
    };

    hydrateAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isAuthLoading,
      user,
      setAuthenticatedUser: (userData: UserData) => {
        setUser(userData);
        setIsAuthenticated(true);
        setIsAuthLoading(false);
      },
      logout: () => {
        clearToken();
        setUser(null);
        setIsAuthenticated(false);
        setIsAuthLoading(false);
      },
    }),
    [isAuthenticated, isAuthLoading, user]
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
