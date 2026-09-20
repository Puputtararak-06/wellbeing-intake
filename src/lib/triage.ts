// BR-01: exactly three hard-coded urgency levels. Mirrors the sealed triage_level table.
export const TRIAGE_LEVELS = [
  {
    id: 1,
    short: "Routine",
    label: "Routine",
    description: "Within the next couple of weeks is fine.",
  },
  {
    id: 2,
    short: "Soon",
    label: "Soon",
    description: "I would like to be seen this week.",
  },
  {
    id: 3,
    short: "Urgent",
    label: "Urgent — I need help now",
    description: "I am in crisis or do not feel safe.",
  },
] as const;

export const ACUTE_LEVEL_ID = 3;

export const triageShort = (id: number) => TRIAGE_LEVELS.find((t) => t.id === id)?.short ?? "Unknown";

export const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted — waiting for a practitioner to open it",
  in_review: "In review — a practitioner has opened your request",
  handled: "Handled — appointment booked",
  escalated: "Escalated — being handled by staff directly",
  closed: "Closed",
};

export const STATUS_SHORT: Record<string, string> = {
  submitted: "Submitted",
  in_review: "In review",
  handled: "Handled",
  escalated: "Escalated",
  closed: "Closed",
};
