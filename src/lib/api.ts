import { Job, JobStatus } from "@/types/job.ts";

const API_BASE = "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function getHeaders(withJson = true): Record<string, string> {
  const headers: Record<string, string> = {};
  if (withJson) headers["Content-Type"] = "application/json";
  return headers;
}

async function apiFetch(path: string, init?: RequestInit, isFormData = false): Promise<Response> {
  const headers = {
    ...getHeaders(!isFormData),
    ...(init?.headers || {}),
  };
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

async function getErrorMessage(res: Response, fallbackMessage: string): Promise<string> {
  const err = await res.json().catch(() => ({}));
  const detail = err?.detail;

  if (typeof detail === "string" && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail)) {
    const joined = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.msg === "string") return item.msg;
        return "";
      })
      .filter(Boolean)
      .join("; ");

    if (joined) {
      return joined;
    }
  }

  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }

  return fallbackMessage;
}

async function throwApiError(res: Response, fallbackMessage: string): Promise<never> {
  const message = await getErrorMessage(res, fallbackMessage);
  throw new ApiError(message, res.status);
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface UserData {
  id: number;
  name: string;
  email: string;
  target_role: string;
  plan: string;
  avatar: null;
}

export interface AuthResponse {
  message: string;
  user: UserData;
}

export interface TaskQueuedResponse {
  task_id: string;
  status: string;
  message: string;
}

export interface ScoreTaskResult {
  scored?: number;
  errors?: string[];
}

export interface TaskStatusResponse {
  task_id: string;
  status: string;
  result?: ScoreTaskResult;
  error?: string | null;
}

export interface MessageResponse {
  message: string;
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  const res = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) await throwApiError(res, "Login failed");
  return res.json();
}

export async function apiRegister(
  name: string,
  email: string,
  password: string,
  confirmPassword: string,
  targetRole: string
): Promise<AuthResponse> {
  const res = await apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      name,
      email,
      password,
      confirm_password: confirmPassword,
      target_role: targetRole,
    }),
  });
  if (!res.ok) await throwApiError(res, "Registration failed");
  return res.json();
}

export async function apiLogout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function apiGetMe(): Promise<UserData> {
  const res = await apiFetch("/auth/me");
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
export async function fetchJobs(): Promise<Job[]> {
  const res = await apiFetch("/api/jobs");
  if (!res.ok) await throwApiError(res, "Failed to fetch jobs");
  return res.json();
}

export async function fetchJob(id: number): Promise<Job> {
  const res = await apiFetch(`/api/jobs/${id}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch job");
  return res.json();
}

export async function updateJobStatus(id: number, status: JobStatus): Promise<void> {
  const res = await apiFetch(`/api/jobs/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) await throwApiError(res, "Failed to update status");
}

export async function updateJobNotes(id: number, notes: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${id}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) await throwApiError(res, "Failed to update notes");
}

export async function runScraper(): Promise<TaskQueuedResponse> {
  const res = await apiFetch("/api/scrape", { method: "POST" });
  if (!res.ok) await throwApiError(res, "Failed to run scraper");
  return res.json();
}

export async function scoreAll(): Promise<TaskQueuedResponse> {
  const res = await apiFetch("/api/score-all", { method: "POST" });
  if (!res.ok) await throwApiError(res, "Failed to score jobs");
  return res.json();
}

export async function fetchScoreAllStatus(taskId: string): Promise<TaskStatusResponse> {
  const res = await apiFetch(`/api/score-all/status?task_id=${encodeURIComponent(taskId)}`);
  if (!res.ok) await throwApiError(res, "Failed to fetch scoring task status");
  return res.json();
}

export async function generateDocuments(id: number): Promise<{ cv_url: string; cover_letter_url: string }> {
  const res = await apiFetch(`/api/generate/${id}`, { method: "POST" });
  if (!res.ok) await throwApiError(res, "Failed to generate documents");
  return res.json();
}

export async function uploadCV(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch("/api/ai/upload_cv", { method: "POST", body: formData }, true);
  if (!res.ok) await throwApiError(res, "Failed to upload CV");
}

export interface CVParsedJson {
  summary?: string;
  education?: unknown[];
  experience?: unknown[];
  skills?: unknown[];
  languages?: unknown[];
  projects?: unknown[];
}

export interface CVLatestResponse {
  has_cv?: boolean;
  status?: "no_cv" | "ready" | "incomplete" | "invalid";
  readiness?: {
    dashboard?: boolean;
    scoring?: boolean;
    parsed_payload?: boolean;
    raw_text?: boolean;
  };
  parsed_json?: CVParsedJson | null;
  suggestions?: string[];
}

export async function fetchLatestCV(): Promise<CVLatestResponse> {
  const res = await apiFetch("/api/cv/latest");
  if (!res.ok) await throwApiError(res, "Failed to fetch CV data");
  return res.json();
}

export type CVUiState = "no_cv" | "uploading" | "ready" | "incomplete" | "invalid";

export function hasParsedResumeContent(parsed?: CVParsedJson | null): boolean {
  if (!parsed) return false;

  if (typeof parsed.summary === "string" && parsed.summary.trim().length > 0) {
    return true;
  }

  return [parsed.education, parsed.experience, parsed.skills, parsed.languages, parsed.projects].some(
    (section) => Array.isArray(section) && section.length > 0
  );
}

export function getCVUiState(cvData?: CVLatestResponse | null, isUploading = false): CVUiState {
  if (isUploading) return "uploading";

  const hasAnyCv = Boolean(cvData?.has_cv);
  if (!hasAnyCv) return "no_cv";

  if (cvData?.readiness?.dashboard) return "ready";

  if (cvData.status === "invalid" || cvData.status === "incomplete" || cvData.status === "ready") {
    return cvData.status === "ready" ? "ready" : cvData.status;
  }

  return hasParsedResumeContent(cvData.parsed_json ?? null) ? "ready" : "incomplete";
}

export async function requestPasswordReset(email: string): Promise<MessageResponse> {
  const res = await apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) await throwApiError(res, "Failed to request password reset");
  return res.json();
}

export async function resetPassword(token: string, newPassword: string): Promise<MessageResponse> {
  const res = await apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
  if (!res.ok) await throwApiError(res, "Failed to reset password");
  return res.json();
}
