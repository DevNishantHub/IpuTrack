// src/utils/dateHelpers.ts
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + (m || 0)
}

// Formats a Date as YYYY-MM-DD using its LOCAL fields (not toISOString,
// which converts to UTC first). For timezones ahead of UTC - e.g. India,
// UTC+5:30 - toISOString() on a local midnight date rolls back to the
// previous day, which was silently doubling every "1 day" navigation step.
const formatLocalDate = (d: Date) => {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export const getTodayDate = () => formatLocalDate(new Date())

// Parses a YYYY-MM-DD string as a local-time date (not UTC), so day-of-week
// calculations aren't off by one near midnight in timezones behind UTC.
const parseLocalDate = (dateStr: string) => new Date(`${dateStr}T00:00:00`)

// Day-of-week (0=Sun..6=Sat, matching DAY_NAMES) for an arbitrary date.
export const getDayOfWeek = (dateStr: string) => parseLocalDate(dateStr).getDay()

// Was hardcoded to `1` (always Monday) regardless of the actual day - kept
// for backward compatibility but now delegates to the real current weekday.
export const getToday = () => getDayOfWeek(getTodayDate())

export const addDaysToDate = (dateStr: string, delta: number) => {
  const d = parseLocalDate(dateStr)
  d.setDate(d.getDate() + delta)
  return formatLocalDate(d)
}

export const isValidDateString = (dateStr: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false
  const d = parseLocalDate(dateStr)
  return !isNaN(d.getTime()) && formatLocalDate(d) === dateStr
}

export const formatDisplayDate = (dateStr: string) => {
  const d = parseLocalDate(dateStr)
  const today = getTodayDate()
  const yesterday = addDaysToDate(today, -1)
  const tomorrow = addDaysToDate(today, 1)
  if (dateStr === today) return "Today"
  if (dateStr === yesterday) return "Yesterday"
  if (dateStr === tomorrow) return "Tomorrow"
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
}
