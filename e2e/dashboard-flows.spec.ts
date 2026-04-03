import { expect, Page, test } from "@playwright/test";

type CVState =
  | {
      has_cv: false;
      status: "no_cv";
      parsed_json: Record<string, never>;
      suggestions: string[];
    }
  | {
      has_cv: true;
      status: "ready";
      readiness: {
        dashboard: true;
        scoring: true;
        parsed_payload: true;
        raw_text: true;
      };
      parsed_json: {
        summary: string;
        skills?: string[];
        experience?: string[];
      };
      suggestions: string[];
    };

type MockJob = {
  id: number;
  title: string;
  company: string;
  location: string;
  url: string;
  date_scraped: string;
  description: string;
  enrichment_status: "pending" | "ready" | "enriched" | "partial" | "missing" | "failed";
  enrichment_error: string;
  scoring_ready: boolean;
  score: number | null;
  score_label: string | null;
  score_reasoning: string[] | null;
  red_flags: string[] | null;
  status: "new" | "scored";
  notes: string;
  events: [];
};

type MockState = {
  latestCV: CVState;
  jobs: MockJob[];
  uploadShouldFail?: boolean;
  scoreStatusCalls: number;
  scrapeStatusCalls?: number;
  scrapeStartResponse?: {
    status: number;
    body: Record<string, unknown>;
  };
  scrapeStatusSequence?: Array<{
    task_id: string;
    status: "queued" | "running" | "retrying" | "success" | "failure";
    progress: {
      phase: "queued" | "launching_browser" | "loading_page" | "extracting_jobs" | "saving_jobs" | "completed" | "failed";
      page: number;
      jobs_found: number;
      jobs_saved: number;
      target_role: string;
      source: string;
    };
    result?: Record<string, unknown> | null;
    error?: string | null;
  }>;
  jobsAfterScrape?: MockJob[];
};

const user = {
  id: 1,
  name: "E2E Tester",
  email: "e2e@example.com",
  target_role: "Engineer",
  plan: "free",
};

function readyCv(summary = "Experienced engineer"): CVState {
  return {
    has_cv: true,
    status: "ready",
    readiness: {
      dashboard: true,
      scoring: true,
      parsed_payload: true,
      raw_text: true,
    },
    parsed_json: {
      summary,
      skills: ["React", "TypeScript", "Python"],
      experience: ["Built production systems"],
    },
    suggestions: [],
  };
}

function newJob(overrides: Partial<MockJob> = {}): MockJob {
  return {
    id: 1,
    title: "Frontend Engineer",
    company: "Acme",
    location: "Remote",
    url: "https://example.com/jobs/1",
    date_scraped: "2026-04-02T00:00:00.000Z",
    description: "Build polished React product experiences.",
    enrichment_status: "ready",
    enrichment_error: "",
    scoring_ready: true,
    score: null,
    score_label: null,
    score_reasoning: null,
    red_flags: null,
    status: "new",
    notes: "",
    events: [],
    ...overrides,
  };
}

function scrapeProgress(
  phase: "queued" | "launching_browser" | "loading_page" | "extracting_jobs" | "saving_jobs" | "completed" | "failed",
  overrides: Partial<{
    page: number;
    jobs_found: number;
    jobs_saved: number;
    target_role: string;
    source: string;
  }> = {}
) {
  return {
    phase,
    page: 0,
    jobs_found: 0,
    jobs_saved: 0,
    target_role: "Engineer",
    source: "JobTeaser",
    ...overrides,
  };
}

function scrapeStatus(
  status: "queued" | "running" | "retrying" | "success" | "failure",
  progress: ReturnType<typeof scrapeProgress>,
  overrides: Partial<{
    task_id: string;
    result: Record<string, unknown> | null;
    error: string | null;
  }> = {}
) {
  return {
    task_id: "scrape-task-1",
    status,
    progress,
    result: null,
    error: null,
    ...overrides,
  };
}

async function mockAppApi(page: Page, state: MockState) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/auth/me") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
      return;
    }

    if (url.pathname === "/auth/logout") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }

    if (url.pathname === "/api/cv/latest") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.latestCV),
      });
      return;
    }

    if (url.pathname === "/api/ai/upload_cv") {
      if (state.uploadShouldFail) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Only PDF CV uploads are supported" }),
        });
        return;
      }

      state.latestCV = readyCv("Freshly uploaded resume");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          message: "CV uploaded successfully",
          filename: "uploaded.pdf",
        }),
      });
      return;
    }

    if (url.pathname === "/api/jobs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.jobs),
      });
      return;
    }

    if (url.pathname === "/api/scrape" && request.method() === "POST") {
      const response = state.scrapeStartResponse ?? {
        status: 202,
        body: {
          task_id: "scrape-task-1",
          status: "queued",
          message: "Scraping jobs for 'Engineer'...",
        },
      };

      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: JSON.stringify(response.body),
      });
      return;
    }

    if (url.pathname === "/api/scrape/status") {
      state.scrapeStatusCalls = (state.scrapeStatusCalls ?? 0) + 1;
      const sequence = state.scrapeStatusSequence ?? [];
      const index = Math.min(state.scrapeStatusCalls - 1, Math.max(sequence.length - 1, 0));
      const payload = sequence[index];

      if (!payload) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ detail: "No mock scrape status configured" }),
        });
        return;
      }

      if (payload.status === "success" && state.jobsAfterScrape) {
        state.jobs = state.jobsAfterScrape;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
      return;
    }

    if (url.pathname === "/api/score-all" && request.method() === "POST") {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          task_id: "score-task-1",
          status: "queued",
          message: "Scoring task started",
        }),
      });
      return;
    }

    if (url.pathname === "/api/score-all/status") {
      state.scoreStatusCalls += 1;

      if (state.scoreStatusCalls < 2) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            task_id: "score-task-1",
            status: "PENDING",
          }),
        });
        return;
      }

      state.jobs = state.jobs.map((job) =>
        job.id === 1
          ? {
              ...job,
              description: "Build polished React product experiences with TypeScript, design systems, testing, and collaboration across product and engineering.".repeat(2),
              enrichment_status: "enriched",
              enrichment_error: "",
              scoring_ready: true,
              score: 91,
              score_label: "Excellent",
              score_reasoning: ["Strong React and product fit"],
              status: "scored",
            }
          : job
      );

      await route.fulfill({
        status: 200,
        contentType: "application/json",
          body: JSON.stringify({
            task_id: "score-task-1",
            status: "success",
            progress: {
              phase: "completed",
              total_jobs: 1,
              jobs_scored: 1,
              jobs_failed: 0,
              jobs_unscorable: 0,
            },
            result: {
              scored: 1,
              unscorable: 0,
              errors: [],
            },
          }),
        });
      return;
    }

    if (url.pathname.startsWith("/api/generate/") && request.method() === "POST") {
      const jobId = Number(url.pathname.split("/").pop());
      const job = state.jobs.find((item) => item.id === jobId);
      if (!job || !job.scoring_ready || job.score === null || job.score_label === "Unscorable") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            detail: "This job is not ready for application generation yet. Run scoring on a complete job description first.",
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          cv_url: `/downloads/cv_${jobId}_modern_english.pdf`,
          cover_letter_url: `/downloads/cover_${jobId}_modern_english.pdf`,
        }),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: `Unhandled mock route: ${url.pathname}` }),
    });
  });
}

async function uploadPdf(page: Page, fileName: string) {
  await page.locator('input[type="file"]').first().setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 mocked pdf"),
  });
}

test("first-time onboarding upload advances to step two", async ({ page }) => {
  const state: MockState = {
    latestCV: {
      has_cv: false,
      status: "no_cv",
      parsed_json: {},
      suggestions: [],
    },
    jobs: [],
    scoreStatusCalls: 0,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
  await uploadPdf(page, "first-resume.pdf");

  await expect(page.getByRole("heading", { name: "Start the job scraper next" })).toBeVisible();
  await expect(page.getByText("CV ready")).toBeVisible();
});

test("replacing a CV updates the displayed filename", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
  };

  await page.addInitScript(() => {
    localStorage.setItem("jarvis_cv_name", "old-resume.pdf");
  });
  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("old-resume.pdf")).toBeVisible();
  await uploadPdf(page, "new-resume.pdf");

  await expect(page.getByText("new-resume.pdf")).toBeVisible();
  await expect(page.getByText("old-resume.pdf")).toHaveCount(0);
});

test("failed CV replacement keeps the previous filename visible", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    uploadShouldFail: true,
    scoreStatusCalls: 0,
  };

  await page.addInitScript(() => {
    localStorage.setItem("jarvis_cv_name", "stable-resume.pdf");
  });
  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("stable-resume.pdf")).toBeVisible();
  await uploadPdf(page, "broken.pdf");

  await expect(page.getByText("stable-resume.pdf")).toBeVisible();
  await expect(page.getByText("broken.pdf")).toHaveCount(0);
  await expect(page.getByText("CV ready")).toBeVisible();
});

test("dashboard shows top matches after a valid CV is loaded", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [
      newJob({ id: 1, title: "Frontend Engineer", score: 88, score_label: "Excellent", status: "scored", score_reasoning: ["Great fit"] }),
      newJob({ id: 2, title: "Product Engineer", company: "Nova", score: 81, score_label: "Good", status: "scored", score_reasoning: ["Strong fit"] }),
    ],
    scoreStatusCalls: 0,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("TOP MATCHES")).toBeVisible();
  await expect(page.getByText("Frontend Engineer")).toBeVisible();
  await expect(page.getByText("Product Engineer")).toBeVisible();
});

test("dashboard waits for trustworthy scoring before showing top matches", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [
      newJob({
        id: 1,
        title: "Frontend Engineer",
        description: "short listing",
        enrichment_status: "partial",
        scoring_ready: false,
        score: 88,
        score_label: "Excellent",
        status: "scored",
        score_reasoning: ["Directional only"],
      }),
    ],
    scoreStatusCalls: 0,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("Top matches will appear after trustworthy scoring is ready")).toBeVisible();
});

test("score-all works after uploading a CV", async ({ page }) => {
  const state: MockState = {
    latestCV: {
      has_cv: false,
      status: "no_cv",
      parsed_json: {},
      suggestions: [],
    },
    jobs: [newJob()],
    scoreStatusCalls: 0,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await uploadPdf(page, "scoring-resume.pdf");
  await expect(page.getByRole("heading", { name: "Start the job scraper next" })).toBeVisible();

  await page.getByRole("button", { name: "Jobs" }).click();
  await expect(page.getByRole("button", { name: "Score All" })).toBeVisible();

  await page.getByRole("button", { name: "Score All" }).click();
  await expect(page.getByRole("button", { name: "Scoring..." })).toBeVisible();

  await expect(page.getByText("91")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("scored")).toBeVisible();
});

test("upload, scrape, score, review, and generate application flows end to end", async ({ page }) => {
  const scrapedJobs = [
    newJob({
      id: 1,
      title: "Frontend Engineer",
      company: "Acme",
      description: "",
      enrichment_status: "pending",
      scoring_ready: false,
      score: null,
      score_label: null,
      status: "new",
    }),
  ];
  const state: MockState = {
    latestCV: {
      has_cv: false,
      status: "no_cv",
      parsed_json: {},
      suggestions: [],
    },
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus("running", scrapeProgress("extracting_jobs", { page: 1, jobs_found: 1 })),
      scrapeStatus(
        "success",
        scrapeProgress("completed", { page: 1, jobs_found: 1, jobs_saved: 1 }),
        {
          result: {
            saved: 1,
            user_id: 1,
            source: "JobTeaser",
            target_role: "Engineer",
            jobs_found: 1,
            jobs_saved: 1,
            progress: scrapeProgress("completed", { page: 1, jobs_found: 1, jobs_saved: 1 }),
          },
        }
      ),
    ],
    jobsAfterScrape: scrapedJobs,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await uploadPdf(page, "pipeline.pdf");
  await page.getByRole("button", { name: "Scrape" }).click();
  await page.waitForTimeout(3200);
  await expect(page.getByText("Last scrape saved 1 job")).toBeVisible();

  await page.getByRole("button", { name: "Jobs" }).click();
  await page.getByRole("button", { name: "Score All" }).click();
  await expect(page.getByText("91")).toBeVisible({ timeout: 10_000 });

  await page.getByText("Frontend Engineer").click();
  await expect(page.getByText("Why This Score Exists")).toBeVisible();
  await page.getByRole("button", { name: /generate application/i }).click();
  await expect(page.getByText("GENERATE APPLICATION")).toBeVisible();
  await page.getByRole("button", { name: /next/i }).click();
  await page.getByRole("button", { name: /generate/i }).click();
  await expect(page.getByText("Documents Ready!")).toBeVisible();
});

test("scrape success shows progress and saves new jobs", async ({ page }) => {
  const scrapedJobs = [
    newJob({ id: 1, title: "Frontend Engineer", company: "Acme", status: "new" }),
    newJob({ id: 2, title: "Platform Engineer", company: "Nova", url: "https://example.com/jobs/2" }),
  ];
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus("running", scrapeProgress("loading_page", { page: 1 })),
      scrapeStatus("running", scrapeProgress("extracting_jobs", { page: 1, jobs_found: 2 })),
      scrapeStatus(
        "success",
        scrapeProgress("completed", { page: 1, jobs_found: 2, jobs_saved: 2 }),
        {
          result: {
            saved: 2,
            user_id: 1,
            source: "JobTeaser",
            target_role: "Engineer",
            jobs_found: 2,
            jobs_saved: 2,
            progress: scrapeProgress("completed", { page: 1, jobs_found: 2, jobs_saved: 2 }),
          },
        }
      ),
    ],
    jobsAfterScrape: scrapedJobs,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await page.getByRole("button", { name: "Scrape" }).click();
  await expect(page.getByText("Loading page 1")).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.getByText("Last scrape saved 2 jobs")).toBeVisible();

  await page.getByRole("button", { name: "Jobs" }).click();
  await expect(page.getByText("Frontend Engineer")).toBeVisible();
  await expect(page.getByText("Platform Engineer")).toBeVisible();
});

test("scrape failure shows actionable guidance", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus(
        "failure",
        scrapeProgress("failed"),
        {
          error: "Executable doesn't exist for browserType.launch",
        }
      ),
    ],
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await page.getByRole("button", { name: "Scrape" }).click();
  await expect(page.getByText("Last scrape failed")).toBeVisible();
  await expect(page.getByText(/Browser setup issue/i)).toBeVisible();
  await expect(page.getByText(/Install Playwright browsers/i)).toBeVisible();
});

test("refresh during an active scrape reconnects to progress", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus("running", scrapeProgress("loading_page", { page: 1 })),
      scrapeStatus("running", scrapeProgress("extracting_jobs", { page: 1, jobs_found: 3 })),
      scrapeStatus("running", scrapeProgress("saving_jobs", { page: 1, jobs_found: 3, jobs_saved: 2 })),
      scrapeStatus(
        "success",
        scrapeProgress("completed", { page: 1, jobs_found: 3, jobs_saved: 2 }),
        {
          result: {
            saved: 2,
            user_id: 1,
            source: "JobTeaser",
            target_role: "Engineer",
            jobs_found: 3,
            jobs_saved: 2,
            progress: scrapeProgress("completed", { page: 1, jobs_found: 3, jobs_saved: 2 }),
          },
        }
      ),
    ],
    jobsAfterScrape: [newJob({ id: 1 }), newJob({ id: 2, title: "Design Engineer", url: "https://example.com/jobs/2" })],
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await page.getByRole("button", { name: "Scrape" }).click();
  await expect(page.getByText("Loading page 1")).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Jobs found: 3/i)).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(page.getByText("Last scrape saved 2 jobs")).toBeVisible();
});

test("no jobs found outcome shows guidance", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus(
        "success",
        scrapeProgress("completed", { page: 1, jobs_found: 0, jobs_saved: 0 }),
        {
          result: {
            saved: 0,
            user_id: 1,
            source: "JobTeaser",
            target_role: "Engineer",
            jobs_found: 0,
            jobs_saved: 0,
            progress: scrapeProgress("completed", { page: 1, jobs_found: 0, jobs_saved: 0 }),
          },
        }
      ),
    ],
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await page.getByRole("button", { name: "Scrape" }).click();
  await expect(page.getByText("Last scrape found no matching jobs")).toBeVisible();
  await expect(page.getByText(/Try adjusting your target role/i)).toBeVisible();
});

test("duplicate scrape prevention keeps the button disabled while running", async ({ page }) => {
  const state: MockState = {
    latestCV: readyCv(),
    jobs: [],
    scoreStatusCalls: 0,
    scrapeStatusCalls: 0,
    scrapeStatusSequence: [
      scrapeStatus("running", scrapeProgress("loading_page", { page: 1 })),
      scrapeStatus("running", scrapeProgress("extracting_jobs", { page: 1, jobs_found: 1 })),
    ],
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await page.getByRole("button", { name: "Scrape" }).click();
  const runningButton = page.getByRole("button", { name: "Loading page 1" });
  await expect(runningButton).toBeDisabled();
  await runningButton.click({ force: true });

  await expect(page.getByText(/Rule: one scrape runs at a time/i)).toBeVisible();
});
