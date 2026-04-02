import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiLogin, apiRegister } from "@/lib/api";
import { LandingPage } from "@/components/LandingPage";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiLogin: vi.fn(),
    apiRegister: vi.fn(),
  };
});

vi.mock("@/components/ParticleBackground", () => ({
  ParticleBackground: () => <div data-testid="particle-bg" />,
}));

const apiLoginMock = vi.mocked(apiLogin);
const apiRegisterMock = vi.mocked(apiRegister);

function renderLandingPage() {
  const onLogin = vi.fn();
  const view = render(
    <MemoryRouter>
      <LandingPage onLogin={onLogin} />
    </MemoryRouter>
  );

  return { ...view, onLogin };
}

describe("LandingPage auth UX", () => {
  beforeEach(() => {
    apiLoginMock.mockReset();
    apiRegisterMock.mockReset();
  });

  it("submits sign in as a real form when Enter is pressed from the email field", async () => {
    const { onLogin } = renderLandingPage();
    apiLoginMock.mockResolvedValue({
      message: "Signed in successfully",
      user: {
        id: 1,
        name: "Test User",
        email: "test@example.com",
        target_role: "Engineer",
        plan: "free",
        avatar: null,
      },
    });

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign In" }).closest("form")!);

    await waitFor(() => {
      expect(apiLoginMock).toHaveBeenCalledWith("test@example.com", "Password123");
    });

    expect(onLogin).toHaveBeenCalled();
  });

  it("clears signup-only fields and stale errors when switching back to sign in", async () => {
    renderLandingPage();

    fireEvent.click(screen.getByRole("tab", { name: "Sign Up" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "Password124" } });
    fireEvent.change(screen.getByLabelText("Target Role"), { target: { value: "Designer" } });

    fireEvent.submit(screen.getByRole("button", { name: "Create Account" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Name is required.");

    fireEvent.click(screen.getByRole("tab", { name: "Sign In" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Sign Up" }));

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Target Role")).toHaveValue("");
    expect(screen.getByLabelText("Confirm Password")).toHaveValue("");
  });

  it("shows immediate client validation for mismatched passwords without sending a request", async () => {
    renderLandingPage();

    fireEvent.click(screen.getByRole("tab", { name: "Sign Up" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "Password124" } });

    fireEvent.submit(screen.getByRole("button", { name: "Create Account" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Passwords do not match.");
    expect(apiRegisterMock).not.toHaveBeenCalled();
  });

  it("shows immediate client validation for weak passwords without sending a request", async () => {
    renderLandingPage();

    fireEvent.click(screen.getByRole("tab", { name: "Sign Up" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test User" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password" } });

    expect(screen.getByText("Password must be at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDisabled();
    expect(apiRegisterMock).not.toHaveBeenCalled();
  });

  it("surfaces API errors through the shared auth messaging path", async () => {
    renderLandingPage();
    apiLoginMock.mockRejectedValue(new ApiError("Invalid credentials", 401));

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Password123" } });
    fireEvent.submit(screen.getByRole("button", { name: "Sign In" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
  });
});
