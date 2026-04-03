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
    description: "This is a complete job description with responsibilities, qualifications, SQL work, dashboards, and stakeholder communication.".repeat(3),
    enrichment_status: "ready",
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

    expect(screen.getByText("Why This Score Exists")).toBeInTheDocument();
    expect(screen.getByText("This score is based on a complete job description and your current CV.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("score breakdown"));
    expect(screen.getByText("Why JARVIS gave this score")).toBeInTheDocument();
    expect(screen.getByText(/Strong SQL and analytics overlap/i)).toBeInTheDocument();
  });

  it("flags limited score context when the job data is incomplete", () => {
    renderJobFeed(
      createJob({
        description: "Short description",
        enrichment_status: "partial",
        scoring_ready: false,
        score: null,
        score_label: "Unscorable",
        score_reasoning: ["This job could not be scored because no usable job description was available for the listing."],
      })
    );

    fireEvent.click(screen.getByText("Data Analyst"));

    expect(screen.getByText("Limited Score Context")).toBeInTheDocument();
    expect(screen.getByText("This job could not be scored because the listing data was too incomplete.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("description"));
    expect(screen.getByText("The stored description is incomplete, so score quality may be lower than usual.")).toBeInTheDocument();
    expect(screen.getByText(/run scoring before generating an application/i)).toBeInTheDocument();
  });
});
