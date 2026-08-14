// Mappa semplificata sui colorId reali di Google Calendar
// (riferimento: https://developers.google.com/calendar/api/v3/reference/colors)
export const EVENT_COLORS = {
  lavanda: "1",
  salvia: "2",
  viola: "3",
  rosa: "4",
  giallo: "5",
  arancione: "6",
  azzurro: "7",
  grigio: "8",
  blu: "9",
  verde: "10",
  rosso: "11",
} as const;

export type EventColorName = keyof typeof EVENT_COLORS;

export function resolveColorId(color?: string): string | undefined {
  if (!color) return undefined;
  return EVENT_COLORS[color as EventColorName];
}
