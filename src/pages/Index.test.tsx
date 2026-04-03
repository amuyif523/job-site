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
    authError: null,
    user: {
      id: 1,
      name: "Test User",
      email: "test@example.com",
      target_role: "Engineer",
      plan: "free",
    },
    isLoggingOut: false,
    setAuthenticatedUser: vi.fn(),
    retryAuth: vi.fn(),
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
    scoreButtonLabel,
  }: {
    onScoreAll?: () => void;
    isScoring?: boolean;
    scoreButtonLabel?: string;
  }) => (
    <div>
      <button onClick={onScoreAll}>Score All</button>
      <span>{scoreButtonLabel}</span>
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
        score_label: null,
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
      status: "success",
      progress: {
        phase: "completed",
        total_jobs: 1,
        jobs_scored: 1,
        jobs_failed: 0,
        jobs_unscorable: 0,
      },
      result: { scored: 1, unscorable: 0, errors: [] },
    });

    renderIndex();

    fireEvent.click(await screen.findByText("Go Jobs"));
    fireEvent.click(screen.getByRole("button", { name: "Score All" }));

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

  it("shows running progress labels while the score task is active", async () => {
    scoreAllMock.mockResolvedValue({
      task_id: "score-task-2",
      status: "queued",
      message: "Scoring task started",
    });
    fetchScoreAllStatusMock.mockResolvedValue({
      task_id: "score-task-2",
      status: "running",
      progress: {
        phase: "running",
        total_jobs: 3,
        jobs_scored: 1,
        jobs_failed: 0,
        jobs_unscorable: 0,
      },
      result: undefined,
      error: null,
    });

    renderIndex();

    fireEvent.click(await screen.findByText("Go Jobs"));
    fireEvent.click(screen.getByRole("button", { name: "Score All" }));

    await waitFor(() => {
      expect(fetchScoreAllStatusMock).toHaveBeenCalledWith("score-task-2");
    });

    await waitFor(() => {
      expect(screen.getByText("Scoring 1/3")).toBeInTheDocument();
    });
  });
});
