import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Index from "@/pages/Index";
import { fetchJobs, fetchLatestCV, fetchScoreAllStatus, scoreAll } from "@/lib/api";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchJobs: vi.fn(),
    fetchLatestCV: vi.fn(),
    fetchScoreAllStatus: vi.fn(),
    scoreAll: vi.fn(),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAuthLoading: false,
    user: {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      target_role: "Engineer",
      plan: "free",
    },
    setAuthenticatedUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/components/ParticleBackground", () => ({
  ParticleBackground: () => <div data-testid="particle-bg" />,
}));

vi.mock("@/components/CVStatusBar", () => ({
  CVStatusBar: () => <div data-testid="cv-status">CV Status</div>,
}));

vi.mock("@/components/Applications", () => ({
  Applications: () => <div>Applications</div>,
}));

vi.mock("@/components/GenerateModal", () => ({
  GenerateModal: () => null,
}));

vi.mock("@/components/SettingsModal", () => ({
  SettingsModal: () => null,
}));

vi.mock("@/components/JarvisChat", () => ({
  JarvisChat: () => null,
}));

vi.mock("@/components/LandingPage", () => ({
  LandingPage: () => <div>Landing</div>,
}));

vi.mock("@/components/ProfileDropdown", () => ({
  ProfileDropdown: () => <div data-testid="profile-dropdown">Profile</div>,
}));

vi.mock("@/components/ProfilePage", () => ({
  ProfilePage: () => <div>Profile Page</div>,
}));

vi.mock("@/components/TemplatesPage", () => ({
  TemplatesPage: () => <div>Templates</div>,
}));

vi.mock("@/components/LeaderboardPage", () => ({
  LeaderboardPage: () => <div>Leaderboard</div>,
}));

vi.mock("@/components/Dashboard", () => ({
  Dashboard: () => <div>Dashboard</div>,
}));

vi.mock("@/components/JarvisSidebar", () => ({
  SIDEBAR_COLLAPSED_WIDTH: 52,
  SIDEBAR_EXPANDED_WIDTH: 200,
  Sidebar: ({ onNavigate }: { onNavigate: (section: string) => void }) => (
    <div>
      <button onClick={() => onNavigate("jobs")}>Go Jobs</button>
    </div>
  ),
}));

vi.mock("@/components/JobFeed", () => ({
  JobFeed: ({
    onScoreAll,
    isScoring,
  }: {
    onScoreAll?: () => void;
    isScoring?: boolean;
  }) => (
    <div>
      <button onClick={onScoreAll}>Score All</button>
      <span>{isScoring ? "Scoring..." : "Idle"}</span>
    </div>
  ),
}));

const fetchJobsMock = vi.mocked(fetchJobs);
const fetchLatestCVMock = vi.mocked(fetchLatestCV);
const fetchScoreAllStatusMock = vi.mocked(fetchScoreAllStatus);
const scoreAllMock = vi.mocked(scoreAll);

function renderIndex() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Index />
    </QueryClientProvider>
  );
}

describe("Index score-all queue behavior", () => {
  beforeEach(() => {
    toastMock.mockReset();
    fetchJobsMock.mockReset();
    fetchLatestCVMock.mockReset();
    fetchScoreAllStatusMock.mockReset();
    scoreAllMock.mockReset();

    fetchJobsMock.mockResolvedValue([
      {
        id: 1,
        title: "Backend Engineer",
        company: "Acme",
        location: "Remote",
        url: "https://example.com/job/1",
        date_scraped: "2026-04-02T00:00:00.000Z",
        description: "Python APIs",
        score: null,
        score_reasoning: null,
        red_flags: null,
        status: "new",
        notes: "",
        events: [],
      },
    ]);
    fetchLatestCVMock.mockResolvedValue({
      has_cv: true,
      status: "ready",
      readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
      parsed_json: { summary: "Experienced engineer" },
      suggestions: [],
    });
  });

  it("shows queued feedback immediately and completion feedback after polling succeeds", async () => {
    scoreAllMock.mockResolvedValue({
      task_id: "score-task-1",
      status: "queued",
      message: "Scoring task started",
    });
    fetchScoreAllStatusMock.mockResolvedValue({
      task_id: "score-task-1",
      status: "SUCCESS",
      result: { scored: 1, errors: [] },
    });

    renderIndex();

    fireEvent.click(await screen.findByText("Go Jobs"));
    fireEvent.click(await screen.findByText("Score All"));

    await waitFor(() => {
      expect(scoreAllMock).toHaveBeenCalledTimes(1);
    });

    expect(toastMock).toHaveBeenCalledWith({
      title: "Scoring task queued",
      description: "Scoring task started",
    });

    await waitFor(() => {
      expect(fetchScoreAllStatusMock).toHaveBeenCalledWith("score-task-1");
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith({
        title: "Scoring complete",
        description: "JARVIS finished scoring 1 job.",
      });
    });
  });
});
