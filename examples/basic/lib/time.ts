/** Formats the current time in an IANA time zone, or throws for an unknown zone. */
export function formatCurrentTime(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "long",
    timeZone,
  }).format(new Date());
}
