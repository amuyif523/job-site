export type JobStatus = "new" | "scored" | "selected" | "applied" | "interviewing" | "offered" | "rejected";

export interface JobEvent {
  type: "scraped" | "enriched" | "scored" | "selected" | "applied" | "interviewing" | "offered" | "rejected";
  timestamp: string;
  score?: number;
  score_label?: string;
}

export interface Job {
  id: number;
  title: string;
  company: string;
  location: string;
  url: string;
  date_scraped: string;
  listing_summary?: string;
  description: string;
  description_quality?: "summary" | "partial" | "full";
  intent_status: "included" | "borderline" | "excluded";
  intent_reason: string;
  matched_keywords: string[];
  blocked_keywords: string[];
  inferred_seniority: "entry-level" | "mid-level" | "senior" | "internship" | "unknown";
  source_confidence: "low" | "medium" | "high";
  enrichment_status: "pending" | "ready" | "enriched" | "partial" | "missing" | "failed";
  enrichment_error: string;
  enrichment_method: "" | "manual" | "html" | "playwright";
  enrichment_duration_ms: number;
  enrichment_retryable: boolean;
  scoring_ready: boolean;
  score: number | null;
  score_label: string | null;
  score_reasoning: string[] | null;
  red_flags: string[] | null;
  status: JobStatus;
  notes?: string;
  events?: JobEvent[];
}
