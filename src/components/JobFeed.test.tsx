import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobFeed } from "@/components/JobFeed";
import type { Job } from "@/types/job";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  updateJobStatus: vi.fn(),
  updateJobNotes: vi.fn(),
}));

function renderJobFeed(job: Job) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <JobFeed jobs={[job]} onGenerateForJob={vi.fn()} />
    </QueryClientProvider>
  );
}

function createJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 1,
    title: "Data Analyst",
    company: "Acme",
    location: "Remote",
    url: "https://example.com/jobs/1",
    date_scraped: "2026-04-03T00:00:00.000Z",
    listing_summary: "Card summary with title, company, and location.",
    description: "This is a complete job description with responsibilities, qualifications, SQL work, dashboards, and stakeholder communication.".repeat(3),
    description_quality: "full",
    intent_status: "included",
    intent_reason: "Included for Data Analyst based on title keyword overlap.",
    matched_keywords: ["data", "analyst"],
    blocked_keywords: [],
    inferred_seniority: "entry-level",
    source_confidence: "high",
    enrichment_status: "ready",
    enrichment_method: "manual",
    enrichment_duration_ms: 0,
    enrichment_retryable: false,
    enrichment_error: "",
    scoring_ready: true,
    score: 82,
    score_label: "Good",
    score_reasoning: ["Strong SQL and analytics overlap with the current CV."],
    red_flags: [],
    status: "scored",
    notes: "",
    events: [],
    ...overrides,
  };
}

describe("JobFeed scoring context", () => {
  it("shows why a score exists for fully-described jobs", () => {
    renderJobFeed(createJob());

    fireEvent.click(screen.getByText("Data Analyst"));

    expect(screen.getAllByText("Full description").length).toBeGreaterThan(0);
    expect(screen.getByText("Why This Score Exists")).toBeInTheDocument();
    expect(screen.getByText("This score is based on a full job description and your current CV.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("score breakdown"));
    expect(screen.getByText("Why JARVIS gave this score")).toBeInTheDocument();
    expect(screen.getByText(/Strong SQL and analytics overlap/i)).toBeInTheDocument();
  });

  it("flags limited score context when the job data is incomplete", () => {
    renderJobFeed(
      createJob({
        listing_summary: "Short listing card summary.",
        description: "",
        enrichment_status: "partial",
        description_quality: "summary",
        scoring_ready: false,
        score: null,
        score_label: "Unscorable",
        score_reasoning: ["This job could not be scored because no usable job description was available for the listing."],
      })
    );

    fireEvent.click(screen.getByText("Data Analyst"));

    expect(screen.getAllByText("Listing summary only").length).toBeGreaterThan(0);
    expect(screen.getByText("Limited Score Context")).toBeInTheDocument();
    expect(screen.getByText("This job could not be scored because the listing data was too incomplete.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("description"));
    expect(screen.getByText("The stored detail-page description is incomplete, so score quality may be lower than usual.")).toBeInTheDocument();
    expect(screen.getByText("No detail-page description is stored yet.")).toBeInTheDocument();
    expect(screen.getByText(/run scoring before generating an application/i)).toBeInTheDocument();
  });
});
