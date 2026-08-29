export const NIGERIA_TIME_ZONE = "Africa/Lagos";

export interface NigeriaDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function formatNigeriaDateTime(timestamp = Date.now()): string {
  return `${new Intl.DateTimeFormat("en-NG", { timeZone: NIGERIA_TIME_ZONE, dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp))} WAT`;
}

export function nigeriaDateParts(timestamp = Date.now()): NigeriaDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}

export function nigeriaLocalTimeToTimestamp(year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const formattedGuess = nigeriaDateParts(guess);
  const nigeriaAsUtc = Date.UTC(formattedGuess.year, formattedGuess.month - 1, formattedGuess.day, formattedGuess.hour, formattedGuess.minute);
  return guess - (nigeriaAsUtc - guess);
}

export function addNigeriaDays(parts: NigeriaDateParts, days: number): NigeriaDateParts {
  return nigeriaDateParts(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute) - 60 * 60 * 1000);
}
