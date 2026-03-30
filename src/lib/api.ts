import { Job, JobStatus } from "@/types/job.ts";

const API_BASE = "http://localhost:8000";

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
  user: UserData;
}

export interface TaskQueuedResponse {
  task_id: string;
  status: string;
  message: string;
}

export async function apiLogin(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Login failed");
  }
  return res.json();
}

export async function apiRegister(
  name: string,
  email: string,
  password: string,
  confirmPassword: string,
  targetRole: string
): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      name,
      email,
      password,
      confirm_password: confirmPassword,
      target_role: targetRole,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Registration failed");
  }
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
  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function fetchJob(id: number): Promise<Job> {
  const res = await apiFetch(`/api/jobs/${id}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function updateJobStatus(id: number, status: JobStatus): Promise<void> {
  const res = await apiFetch(`/api/jobs/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update status");
}

export async function updateJobNotes(id: number, notes: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${id}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes }),
  });
  if (!res.ok) throw new Error("Failed to update notes");
}

export async function runScraper(): Promise<TaskQueuedResponse> {
  const res = await apiFetch("/api/scrape", { method: "POST" });
  if (!res.ok) throw new Error("Failed to run scraper");
  return res.json();
}

export async function scoreAll(): Promise<TaskQueuedResponse> {
  const res = await apiFetch("/api/score-all", { method: "POST" });
  if (!res.ok) throw new Error("Failed to score jobs");
  return res.json();
}

export async function generateDocuments(id: number): Promise<{ cv_url: string; cover_letter_url: string }> {
  const res = await apiFetch(`/api/generate/${id}`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to generate documents");
  return res.json();
}

export async function uploadCV(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await apiFetch("/api/cv", { method: "POST", body: formData }, true);
  if (!res.ok) throw new Error("Failed to upload CV");
}
