import { expect, Page, test } from "@playwright/test";

type MockUser = {
  id: number;
  name: string;
  email: string;
  target_role: string;
  plan: string;
};

type AuthMockState = {
  authenticated: boolean;
  authMeMode?: "ok" | "unauthenticated" | "unavailable" | "recover_on_retry";
  authMeCalls: number;
  loginShouldFail?: boolean;
  signupShouldFail?: boolean;
  user: MockUser;
};

const defaultUser: MockUser = {
  id: 1,
  name: "E2E Tester",
  email: "e2e@example.com",
  target_role: "Engineer",
  plan: "free",
};

async function mockAuthAppApi(page: Page, state: AuthMockState) {
  await page.route("http://localhost:8000/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/auth/me") {
      state.authMeCalls += 1;

      if (state.authMeMode === "unavailable") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Session service unavailable" }),
        });
        return;
      }

      if (state.authMeMode === "recover_on_retry" && state.authMeCalls === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Session service unavailable" }),
        });
        return;
      }

      if (!state.authenticated || state.authMeMode === "unauthenticated") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Not authenticated" }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(state.user),
      });
      return;
    }

    if (url.pathname === "/auth/login" && request.method() === "POST") {
      if (state.loginShouldFail) {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Invalid email or password" }),
        });
        return;
      }

      state.authenticated = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Signed in successfully",
          user: state.user,
        }),
      });
      return;
    }

    if (url.pathname === "/auth/register" && request.method() === "POST") {
      if (state.signupShouldFail) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Email already registered" }),
        });
        return;
      }

      state.authenticated = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          message: "Account created successfully",
          user: state.user,
        }),
      });
      return;
    }

    if (url.pathname === "/auth/logout" && request.method() === "POST") {
      state.authenticated = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    if (url.pathname === "/api/jobs") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
      return;
    }

    if (url.pathname === "/api/cv/latest") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          has_cv: false,
          status: "no_cv",
          readiness: {
            dashboard: false,
            scoring: false,
            parsed_payload: false,
            raw_text: false,
          },
          parsed_json: {},
          suggestions: [],
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

test("successful signup takes the user into the authenticated dashboard flow", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: false,
    authMeMode: "unauthenticated",
    authMeCalls: 0,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await page.getByRole("tab", { name: "Sign Up" }).click();
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel(/Email/).fill("e2e@example.com");
  await page.getByLabel(/^Password$/).fill("Password123");
  await page.getByLabel("Confirm Password").fill("Password123");
  await page.getByLabel("Target Role").fill("Engineer");
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
});

test("successful signin takes the user into the authenticated dashboard flow", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: false,
    authMeMode: "unauthenticated",
    authMeCalls: 0,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("Password123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
});

test("failed signin keeps the user on the landing page with a clear error", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: false,
    authMeMode: "unauthenticated",
    authMeCalls: 0,
    loginShouldFail: true,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("WrongPassword123");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");
  await expect(page.getByText("Your AI Job Search Copilot")).toBeVisible();
});

test("logout returns the user to the landing page", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: true,
    authMeMode: "ok",
    authMeCalls: 0,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
  await page.getByRole("button", { name: "ET" }).click();
  await page.getByRole("button", { name: "Sign Out" }).click();

  await expect(page.getByText("Your AI Job Search Copilot")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("auth persists across refresh when the backend session is still valid", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: true,
    authMeMode: "ok",
    authMeCalls: 0,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
});

test("degraded auth hydration shows recovery UI and can retry successfully", async ({ page }) => {
  const state: AuthMockState = {
    authenticated: true,
    authMeMode: "recover_on_retry",
    authMeCalls: 0,
    user: defaultUser,
  };

  await mockAuthAppApi(page, state);
  await page.goto("/");

  await expect(page.getByText("Authentication Unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Retry Session Check" }).click();

  await expect(page.getByRole("heading", { name: "Upload Your Resume to Begin" })).toBeVisible();
});
