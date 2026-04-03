import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Sidebar } from "@/components/JarvisSidebar";
import { toast } from "@/hooks/use-toast";
import { fetchScrapeStatus, runScraper } from "@/lib/api";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    runScraper: vi.fn(),
    fetchScrapeStatus: vi.fn(),
  };
});

const runScraperMock = vi.mocked(runScraper);
const fetchScrapeStatusMock = vi.mocked(fetchScrapeStatus);
const toastMock = vi.mocked(toast);
const USER_ID = 1;

function scopedKey(baseKey: string, userId = USER_ID) {
  return `${baseKey}:${userId}`;
}

function renderSidebar(collapsed = false, onCollapsedChange = vi.fn(), targetRole = "Engineer", userId = USER_ID) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Sidebar
        active="dashboard"
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        onNavigate={vi.fn()}
        onOpenSettings={vi.fn()}
        userId={userId}
        targetRole={targetRole}
      />
    </QueryClientProvider>
  );
}

describe("Sidebar scrape flow", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    runScraperMock.mockReset();
    fetchScrapeStatusMock.mockReset();
    toastMock.mockReset();
  });

  it("renders expanded navigation labels and requests collapse", () => {
    const onCollapsedChange = vi.fn();
    renderSidebar(false, onCollapsedChange);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("renders collapsed state with compact branding and requests expansion", () => {
    const onCollapsedChange = vi.fn();
    renderSidebar(true, onCollapsedChange);

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    expect(screen.getByText("J")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("does not start scrape cooldown until the scrape succeeds", async () => {
    vi.useFakeTimers();
    runScraperMock.mockResolvedValue({
      task_id: "scrape-task-1",
      status: "queued",
      message: "Scraping jobs for 'Engineer'...",
    });
    fetchScrapeStatusMock.mockResolvedValue({
      task_id: "scrape-task-1",
      status: "running",
      progress: {
        phase: "loading_page",
        page: 2,
        jobs_found: 0,
        jobs_saved: 0,
        target_role: "Engineer",
        source: "JobTeaser",
      },
      result: null,
      error: null,
    });

    renderSidebar(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scrape" }));
      await Promise.resolve();
    });

    expect(runScraperMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(scopedKey("jarvis_last_scrape"))).toBeNull();
    expect(localStorage.getItem(scopedKey("jarvis_active_scrape_task_id"))).toBe("scrape-task-1");
    expect(screen.getByRole("button", { name: /Loading page 2/i })).toBeInTheDocument();

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    expect(fetchScrapeStatusMock).toHaveBeenCalledWith("scrape-task-1");
    expect(localStorage.getItem(scopedKey("jarvis_last_scrape"))).toBeNull();
    expect(screen.getByRole("button", { name: /Loading page 2/i })).toBeInTheDocument();
  });

  it("stores cooldown timing after a successful scrape completes", async () => {
    vi.useFakeTimers();
    runScraperMock.mockResolvedValue({
      task_id: "scrape-task-2",
      status: "queued",
      message: "Scraping jobs for 'Engineer'...",
    });
    fetchScrapeStatusMock.mockResolvedValue({
      task_id: "scrape-task-2",
      status: "success",
      progress: {
        phase: "completed",
        page: 4,
        jobs_found: 18,
        jobs_saved: 12,
        target_role: "Engineer",
        source: "JobTeaser",
      },
      result: {
        saved: 12,
        user_id: 1,
        source: "JobTeaser",
        target_role: "Engineer",
        jobs_found: 18,
        jobs_saved: 12,
        progress: {
          phase: "completed",
          page: 4,
          jobs_found: 18,
          jobs_saved: 12,
          target_role: "Engineer",
          source: "JobTeaser",
        },
      },
      error: null,
    });

    renderSidebar(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scrape" }));
      await Promise.resolve();
    });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await Promise.resolve();
    });

    expect(localStorage.getItem(scopedKey("jarvis_last_scrape"))).not.toBeNull();
    expect(localStorage.getItem(scopedKey("jarvis_active_scrape_task_id"))).toBeNull();
    expect(screen.getByText("Last scrape saved 12 jobs")).toBeInTheDocument();
  });

  it("restores an active scrape after refresh and reconnects polling", async () => {
    vi.useFakeTimers();
    localStorage.setItem(scopedKey("jarvis_active_scrape_task_id"), "scrape-task-restored");
    localStorage.setItem(
      scopedKey("jarvis_active_scrape_progress"),
      JSON.stringify({
        phase: "extracting_jobs",
        page: 3,
        jobs_found: 7,
        jobs_saved: 0,
        target_role: "Engineer",
        source: "JobTeaser",
      })
    );

    fetchScrapeStatusMock.mockResolvedValue({
      task_id: "scrape-task-restored",
      status: "running",
      progress: {
        phase: "saving_jobs",
        page: 3,
        jobs_found: 7,
        jobs_saved: 5,
        target_role: "Engineer",
        source: "JobTeaser",
      },
      result: null,
      error: null,
    });

    await act(async () => {
      renderSidebar(false);
      await Promise.resolve();
    });

    expect(localStorage.getItem(scopedKey("jarvis_active_scrape_task_id"))).toBe("scrape-task-restored");

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchScrapeStatusMock).toHaveBeenCalledWith("scrape-task-restored");
    expect(screen.getByRole("button", { name: /Saving 5 jobs/i })).toBeInTheDocument();
  });

  it("keeps an active scrape visible when polling temporarily fails", async () => {
    vi.useFakeTimers();
    localStorage.setItem(scopedKey("jarvis_active_scrape_task_id"), "scrape-task-backoff");
    localStorage.setItem(
      scopedKey("jarvis_active_scrape_progress"),
      JSON.stringify({
        phase: "loading_page",
        page: 1,
        jobs_found: 0,
        jobs_saved: 0,
        target_role: "Engineer",
        source: "JobTeaser",
      })
    );

    fetchScrapeStatusMock
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({
        task_id: "scrape-task-backoff",
        status: "running",
        progress: {
          phase: "extracting_jobs",
          page: 2,
          jobs_found: 9,
          jobs_saved: 0,
          target_role: "Engineer",
          source: "JobTeaser",
        },
        result: null,
        error: null,
      });

    await act(async () => {
      renderSidebar(false);
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText(/Status temporarily unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Page: 1/i)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
      await Promise.resolve();
    });

    expect(screen.queryByText(/Status temporarily unavailable/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Found 9 jobs/i })).toBeInTheDocument();
  });

  it("prevents launching a second scrape while one is already active", async () => {
    vi.useFakeTimers();
    runScraperMock.mockResolvedValue({
      task_id: "scrape-task-3",
      status: "queued",
      message: "Scraping jobs for 'Engineer'...",
    });
    fetchScrapeStatusMock.mockResolvedValue({
      task_id: "scrape-task-3",
      status: "running",
      progress: {
        phase: "loading_page",
        page: 1,
        jobs_found: 0,
        jobs_saved: 0,
        target_role: "Engineer",
        source: "JobTeaser",
      },
      result: null,
      error: null,
    });

    renderSidebar(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Scrape" }));
      await Promise.resolve();
    });

    const queuedButton = screen.getByRole("button", { name: /Loading page 1/i });
    expect(queuedButton).toBeDisabled();

    fireEvent.click(queuedButton);
    expect(runScraperMock).toHaveBeenCalledTimes(1);
  });

  it("shows empty-state guidance after a successful scrape with no jobs found", () => {
    localStorage.setItem(
      scopedKey("jarvis_last_scrape_summary"),
      JSON.stringify({
        status: "success",
        timestamp: Date.now(),
        source: "JobTeaser",
        targetRole: "Engineer",
        jobsFound: 0,
        jobsSaved: 0,
        error: null,
      })
    );
    localStorage.setItem(scopedKey("jarvis_last_scrape"), Date.now().toString());

    renderSidebar(false);

    expect(screen.getByText("Last scrape found no matching jobs")).toBeInTheDocument();
    expect(screen.getByText(/Try adjusting your target role/i)).toBeInTheDocument();
  });

  it("does not inherit cooldown from a different account", () => {
    localStorage.setItem("jarvis_last_scrape", Date.now().toString());
    localStorage.setItem(scopedKey("jarvis_last_scrape", 99), Date.now().toString());

    renderSidebar(false, vi.fn(), "Data Science", 2);

    expect(screen.getByRole("button", { name: "Scrape" })).toBeEnabled();
    expect(screen.queryByText(/Cooldown active/i)).not.toBeInTheDocument();
  });
});
