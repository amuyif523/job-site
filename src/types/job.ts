export type JobStatus = "new" | "scored" | "selected" | "applied" | "rejected";

export interface JobEvent {
  type: "scraped" | "scored" | "selected" | "applied" | "rejected";
  timestamp: string;
  score?: number;
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
  score_reasoning: string[] | null;
  red_flags: string[] | null;
  status: JobStatus;
  notes?: string;
  events?: JobEvent[];
}
