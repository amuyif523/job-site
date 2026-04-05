import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Dashboard } from "@/components/Dashboard";
import type { CVLatestResponse } from "@/lib/api";
import type { Job } from "@/types/job";

vi.mock("recharts", () => {
  const Mock = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Mock,
    BarChart: Mock,
    Bar: Mock,
    XAxis: Mock,
    YAxis: Mock,
    Tooltip: Mock,
    Cell: () => <div />,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

function renderDashboard(cvData: CVLatestResponse | null, jobs: Job[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard jobs={jobs} cvData={cvData} onGenerateForJob={vi.fn()} />
    </QueryClientProvider>
  );
}

function createJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    title: "Frontend Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://example.com/jobs/1",
    date_scraped: "2026-04-02T00:00:00.000Z",
    description: "Build product experiences with cross-functional collaboration, strong product judgment, TypeScript systems, metrics ownership, and end-to-end delivery across engineering teams.".repeat(2),
    intent_status: "included",
    intent_reason: "Included for Frontend Engineer based on title keyword overlap.",
    matched_keywords: ["engineer"],
    blocked_keywords: [],
    inferred_seniority: "mid-level",
    source_confidence: "high",
    enrichment_status: "ready",
    enrichment_method: "manual",
    enrichment_duration_ms: 0,
    enrichment_retryable: false,
    enrichment_error: "",
    scoring_ready: true,
    score: 88,
    score_label: "Excellent",
    score_reasoning: ["Strong product fit"],
    red_flags: [],
    status: "new",
    notes: "",
    events: [],
    ...overrides,
  };
}

describe("Dashboard state branching", () => {
  it("renders onboarding recovery for no CV and no jobs", () => {
    renderDashboard({ has_cv: false, status: "no_cv", parsed_json: {}, suggestions: [] }, []);

    expect(screen.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeInTheDocument();
    expect(screen.queryByText("Step 2: Find Opportunities")).not.toBeInTheDocument();
    expect(screen.queryByText("TOP MATCHES")).not.toBeInTheDocument();
  });

  it("renders step two guidance for valid CV and no jobs", () => {
    renderDashboard(
      {
        has_cv: true,
        status: "ready",
        readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
        parsed_json: { summary: "Experienced engineer", skills: ["React", "TypeScript"] },
        suggestions: [],
      },
      []
    );

    expect(screen.getByText("Step 2: Find Opportunities")).toBeInTheDocument();
    expect(screen.queryByText("Upload Your Resume to Begin")).not.toBeInTheDocument();
    expect(screen.queryByText("TOP MATCHES")).not.toBeInTheDocument();
  });

  it("renders top matches for valid CV and jobs", () => {
    renderDashboard(
      {
        has_cv: true,
        status: "ready",
        readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
        parsed_json: { summary: "Experienced engineer", skills: ["React", "TypeScript"] },
        suggestions: [],
      },
      [createJob()]
    );

    expect(screen.getByText("TOP MATCHES")).toBeInTheDocument();
    expect(screen.getByText("Frontend Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Step 2: Find Opportunities")).not.toBeInTheDocument();
  });

  it("does not promote incomplete jobs as top matches", () => {
    renderDashboard(
      {
        has_cv: true,
        status: "ready",
        readiness: { dashboard: true, scoring: true, parsed_payload: true, raw_text: true },
        parsed_json: { summary: "Experienced engineer", skills: ["React", "TypeScript"] },
        suggestions: [],
      },
      [createJob({ score: 91, scoring_ready: false, enrichment_status: "partial", description: "short" })]
    );

    expect(screen.getByText("Top matches will appear after trustworthy scoring is ready")).toBeInTheDocument();
  });

  it("renders recovery guidance for invalid or empty CV payloads", () => {
    renderDashboard({ has_cv: true, status: "invalid", parsed_json: {}, suggestions: [] }, []);

    expect(screen.getByText("We could not read your current CV")).toBeInTheDocument();
    expect(screen.getByText("Re-upload CV")).toBeInTheDocument();
    expect(screen.queryByText("TOP MATCHES")).not.toBeInTheDocument();
  });
});
