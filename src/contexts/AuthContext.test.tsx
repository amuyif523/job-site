import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ApiError, apiGetMe, apiLogout, type UserData } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGetMe: vi.fn(),
    apiLogout: vi.fn(),
  };
});

const apiGetMeMock = vi.mocked(apiGetMe);
const apiLogoutMock = vi.mocked(apiLogout);

const mockUser: UserData = {
  id: 1,
  name: "Test User",
  email: "test@example.com",
  target_role: "Engineer",
  plan: "free",
  avatar: null,
};

function AuthStateProbe() {
  const { isAuthenticated, isAuthLoading, authError, user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  return (
    <div>
      <div data-testid="auth-loading">{String(isAuthLoading)}</div>
      <div data-testid="auth-status">{isAuthenticated ? "authenticated" : "unauthenticated"}</div>
      <div data-testid="auth-user">{user?.email ?? "none"}</div>
      <div data-testid="auth-error">{authError ?? "none"}</div>
      <div data-testid="logout-error">{logoutError ?? "none"}</div>
      <button
        type="button"
        onClick={async () => {
          try {
            await logout();
            setLogoutError(null);
          } catch (error) {
            setLogoutError(error instanceof Error ? error.message : "unknown");
          }
        }}
      >
        Logout
      </button>
    </div>
  );
}

function ProtectedAuthHarness() {
  const { isAuthenticated, isAuthLoading, authError, retryAuth } = useAuth();

  return (
    <ProtectedRoute
      isAuthenticated={isAuthenticated}
      isLoading={isAuthLoading}
      authError={authError}
      onRetry={() => {
        void retryAuth();
      }}
      fallback={<div>Landing</div>}
    >
      <div>App</div>
    </ProtectedRoute>
  );
}

function renderWithAuthProvider(children: ReactNode) {
  return render(<AuthProvider>{children}</AuthProvider>);
}

describe("AuthProvider state handling", () => {
  beforeEach(() => {
    apiGetMeMock.mockReset();
    apiLogoutMock.mockReset();
  });

  it("hydrates an authenticated session successfully", async () => {
    apiGetMeMock.mockResolvedValue(mockUser);

    renderWithAuthProvider(<AuthStateProbe />);

    expect(screen.getByTestId("auth-loading").textContent).toBe("true");

    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
    });

    expect(screen.getByTestId("auth-user").textContent).toBe("test@example.com");
    expect(screen.getByTestId("auth-error").textContent).toBe("none");
  });

  it("treats 401 session checks as unauthenticated instead of an auth outage", async () => {
    apiGetMeMock.mockRejectedValue(new ApiError("Not authenticated", 401));

    renderWithAuthProvider(<AuthStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("auth-loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("auth-status").textContent).toBe("unauthenticated");
    expect(screen.getByTestId("auth-user").textContent).toBe("none");
    expect(screen.getByTestId("auth-error").textContent).toBe("none");
  });

  it("shows an auth-unavailable state instead of the landing page when session hydration fails transiently", async () => {
    apiGetMeMock.mockRejectedValue(new ApiError("Server unavailable", 503));

    renderWithAuthProvider(<ProtectedAuthHarness />);

    expect(await screen.findByText("Authentication Unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Landing")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't verify your session/i)).toBeInTheDocument();
  });

  it("clears local auth state only after logout succeeds", async () => {
    apiGetMeMock.mockResolvedValue(mockUser);
    apiLogoutMock.mockResolvedValue(undefined);

    renderWithAuthProvider(<AuthStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
    });

    fireEvent.click(screen.getByText("Logout"));

    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe("unauthenticated");
    });

    expect(screen.getByTestId("auth-user").textContent).toBe("none");
    expect(screen.getByTestId("logout-error").textContent).toBe("none");
  });

  it("preserves the session locally when logout fails", async () => {
    apiGetMeMock.mockResolvedValue(mockUser);
    apiLogoutMock.mockRejectedValue(new ApiError("Failed to sign out", 500));

    renderWithAuthProvider(<AuthStateProbe />);

    await waitFor(() => {
      expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
    });

    fireEvent.click(screen.getByText("Logout"));

    await waitFor(() => {
      expect(screen.getByTestId("logout-error").textContent).toBe("Failed to sign out");
    });

    expect(screen.getByTestId("auth-status").textContent).toBe("authenticated");
    expect(screen.getByTestId("auth-user").textContent).toBe("test@example.com");
  });
});
