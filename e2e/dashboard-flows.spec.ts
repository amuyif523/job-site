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
  score: number | null;
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
    score: null,
    score_reasoning: null,
    red_flags: null,
    status: "new",
    notes: "",
    events: [],
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
              score: 91,
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
          status: "SUCCESS",
          result: {
            scored: 1,
            errors: [],
          },
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
      newJob({ id: 1, title: "Frontend Engineer", score: 88, status: "scored", score_reasoning: ["Great fit"] }),
      newJob({ id: 2, title: "Product Engineer", company: "Nova", score: 81, status: "scored", score_reasoning: ["Strong fit"] }),
    ],
    scoreStatusCalls: 0,
  };

  await mockAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("TOP MATCHES")).toBeVisible();
  await expect(page.getByText("Frontend Engineer")).toBeVisible();
  await expect(page.getByText("Product Engineer")).toBeVisible();
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
