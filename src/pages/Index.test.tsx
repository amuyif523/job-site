import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Index from "@/pages/Index";
import { fetchJobs, fetchLatestCV, fetchScoreAllStatus, scoreAll } from "@/lib/api";

const toastMock = vi.fn();
const authState = {
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
};

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
  useAuth: () => authState,
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
const USER_ID = 1;

function scopedKey(baseKey: string, userId = USER_ID) {
  return `${baseKey}:${userId}`;
}

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
    vi.useRealTimers();
    localStorage.clear();
    authState.user.id = USER_ID;
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
        intent_status: "included",
        intent_reason: "Included for Engineer based on title keyword overlap.",
        matched_keywords: ["engineer"],
        blocked_keywords: [],
        inferred_seniority: "mid-level",
        source_confidence: "medium",
        enrichment_status: "partial",
        enrichment_error: "",
        scoring_ready: false,
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

    expect(screen.getByText(/Last result: success/i)).toBeInTheDocument();
    expect(screen.getByText("Scored")).toBeInTheDocument();

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

    expect(screen.getByText("Scoring jobs")).toBeInTheDocument();
    expect(screen.getByText("Remaining")).toBeInTheDocument();
  });

  it("restores an active score task after refresh and reconnects polling", async () => {
    localStorage.setItem(scopedKey("jarvis_active_score_task_id"), "score-task-restored");
    localStorage.setItem(
      scopedKey("jarvis_active_score_progress"),
      JSON.stringify({
        phase: "running",
        total_jobs: 4,
        jobs_scored: 1,
        jobs_failed: 0,
        jobs_unscorable: 0,
      })
    );

    fetchScoreAllStatusMock.mockResolvedValue({
      task_id: "score-task-restored",
      status: "running",
      progress: {
        phase: "running",
        total_jobs: 4,
        jobs_scored: 2,
        jobs_failed: 0,
        jobs_unscorable: 1,
      },
      result: undefined,
      error: null,
    });

    renderIndex();

    await waitFor(() => {
      expect(fetchScoreAllStatusMock).toHaveBeenCalledWith("score-task-restored");
    });

    expect(screen.getByText("Scoring jobs")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Skipped")).toBeInTheDocument();
  });

  it("keeps the score task visible when polling temporarily fails and retries with backoff", async () => {
    vi.useFakeTimers();
    localStorage.setItem(scopedKey("jarvis_active_score_task_id"), "score-task-backoff");
    localStorage.setItem(
      scopedKey("jarvis_active_score_progress"),
      JSON.stringify({
        phase: "running",
        total_jobs: 5,
        jobs_scored: 1,
        jobs_failed: 0,
        jobs_unscorable: 0,
      })
    );

    fetchScoreAllStatusMock
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({
        task_id: "score-task-backoff",
        status: "running",
        progress: {
          phase: "running",
          total_jobs: 5,
          jobs_scored: 3,
          jobs_failed: 1,
          jobs_unscorable: 0,
        },
        result: undefined,
        error: null,
      });

    await act(async () => {
      renderIndex();
      await Promise.resolve();
    });

    expect(fetchScoreAllStatusMock).toHaveBeenCalledWith("score-task-backoff");

    expect(screen.getByText(/Status temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("Scoring jobs")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    expect(fetchScoreAllStatusMock).toHaveBeenCalledTimes(2);

    expect(screen.queryByText(/Status temporarily unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows partial-failure guidance when some jobs fail or are skipped", async () => {
    scoreAllMock.mockResolvedValue({
      task_id: "score-task-partial",
      status: "queued",
      message: "Scoring task started",
    });
    fetchScoreAllStatusMock.mockResolvedValue({
      task_id: "score-task-partial",
      status: "success",
      progress: {
        phase: "completed",
        total_jobs: 3,
        jobs_scored: 1,
        jobs_failed: 1,
        jobs_unscorable: 1,
      },
      result: {
        scored: 1,
        unscorable: 1,
        errors: [
          "job_id=2: Rate limit hit",
          "job_id=3: incomplete job description; scoring skipped",
        ],
      },
    });

    renderIndex();

    fireEvent.click(await screen.findByText("Go Jobs"));
    fireEvent.click(screen.getByRole("button", { name: "Score All" }));

    await waitFor(() => {
      expect(screen.getByText(/1 failed, 1 skipped/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Retry after the provider rate limit window resets/i)).toBeInTheDocument();
    expect(screen.getByText(/Rate limit hit/i)).toBeInTheDocument();
  });

  it("shows full failure guidance when the score task fails", async () => {
    scoreAllMock.mockResolvedValue({
      task_id: "score-task-failed",
      status: "queued",
      message: "Scoring task started",
    });
    fetchScoreAllStatusMock.mockResolvedValue({
      task_id: "score-task-failed",
      status: "failure",
      progress: {
        phase: "failed",
        total_jobs: 2,
        jobs_scored: 0,
        jobs_failed: 2,
        jobs_unscorable: 0,
      },
      result: null,
      error: "Missing backend model provider key.",
    });

    renderIndex();

    fireEvent.click(await screen.findByText("Go Jobs"));
    fireEvent.click(screen.getByRole("button", { name: "Score All" }));

    await waitFor(() => {
      expect(screen.getByText(/Missing backend model provider key/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Check the configured AI provider key and try again/i)).toBeInTheDocument();
  });

  it("ignores another user's persisted score task state", async () => {
    localStorage.setItem("jarvis_active_score_task_id:2", "score-task-other-user");
    localStorage.setItem(
      "jarvis_active_score_progress:2",
      JSON.stringify({
        phase: "running",
        total_jobs: 4,
        jobs_scored: 2,
        jobs_failed: 0,
        jobs_unscorable: 0,
      })
    );

    renderIndex();

    await waitFor(() => {
      expect(fetchJobsMock).toHaveBeenCalled();
    });

    expect(fetchScoreAllStatusMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Scoring jobs")).not.toBeInTheDocument();
  });
});
