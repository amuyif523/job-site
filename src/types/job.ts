export type JobStatus = "new" | "scored" | "selected" | "applied" | "interviewing" | "offered" | "rejected";

export interface JobEvent {
  type: "scraped" | "scored" | "selected" | "applied" | "interviewing" | "offered" | "rejected";
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
  description: string;
  score: number | null;
  score_label: string | null;
  score_reasoning: string[] | null;
  red_flags: string[] | null;
  status: JobStatus;
  notes?: string;
  events?: JobEvent[];
}
