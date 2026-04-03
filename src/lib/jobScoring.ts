import type { Job } from "@/types/job";

export const MIN_RELIABLE_DESCRIPTION_LENGTH = 200;

export function isJobScoringReady(job: Job): boolean {
  return Boolean(
    job.scoring_ready &&
      (job.description?.trim().length ?? 0) >= MIN_RELIABLE_DESCRIPTION_LENGTH &&
      job.score_label !== "Unscorable"
  );
}

export function canGenerateForJob(job: Job): boolean {
  return isJobScoringReady(job) && job.score !== null;
}

export function hasIncompleteScoreData(job: Job): boolean {
  const description = job.description?.trim() || "";
  const reasons = job.score_reasoning ?? [];
  const warningText = `${reasons.join(" ")} ${(job.red_flags ?? []).join(" ")} ${job.enrichment_error ?? ""}`.toLowerCase();

  return (
    job.score_label === "Unscorable" ||
    !job.scoring_ready ||
    description.length < MIN_RELIABLE_DESCRIPTION_LENGTH ||
    warningText.includes("no usable job description") ||
    warningText.includes("missing job description") ||
    warningText.includes("incomplete job description") ||
    warningText.includes("enrichment failed")
  );
}

export function getScoreContextMessage(job: Job): string {
  if (job.score_label === "Unscorable") {
    return "This job could not be scored because the listing data was too incomplete.";
  }

  if (hasIncompleteScoreData(job)) {
    return "This score was generated from limited job data, so treat it as directional rather than final.";
  }

  return "This score is based on a complete job description and your current CV.";
}

export function getGenerationBlockReason(job: Job): string {
  if (job.score === null) {
    return "Run scoring before generating an application for this job.";
  }
  if (job.score_label === "Unscorable") {
    return "This job cannot generate an application because the listing data was too incomplete to score.";
  }
  if (!job.scoring_ready) {
    return "This job needs a fuller description before JARVIS can generate a trustworthy application.";
  }
  return "";
}

export function isReliableTopMatch(job: Job): boolean {
  return canGenerateForJob(job);
}
