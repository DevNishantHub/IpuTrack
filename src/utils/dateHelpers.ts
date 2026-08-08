// src/utils/dateHelpers.ts
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + (m || 0)
}

export const getToday = () => 1
export const getTodayDate = () => new Date().toISOString().split("T")[0]
