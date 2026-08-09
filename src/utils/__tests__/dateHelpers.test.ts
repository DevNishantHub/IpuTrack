import {
  toMinutes,
  getDayOfWeek,
  addDaysToDate,
  isValidDateString,
  formatDisplayDate,
  getTodayDate
} from "../dateHelpers"

describe("toMinutes", () => {
  it("converts HH:MM to minutes since midnight", () => {
    expect(toMinutes("00:00")).toBe(0)
    expect(toMinutes("01:30")).toBe(90)
    expect(toMinutes("23:59")).toBe(1439)
  })

  it("handles missing minutes gracefully", () => {
    expect(toMinutes("08")).toBe(480)
  })
})

describe("isValidDateString", () => {
  it("accepts valid YYYY-MM-DD dates", () => {
    expect(isValidDateString("2026-01-05")).toBe(true)
    expect(isValidDateString("2024-02-29")).toBe(true) // leap year
  })

  it("rejects malformed or out-of-range dates", () => {
    expect(isValidDateString("2026-13-45")).toBe(false)
    expect(isValidDateString("not-a-date")).toBe(false)
    expect(isValidDateString("2026-02-30")).toBe(false) // Feb has no 30th
    expect(isValidDateString("2023-02-29")).toBe(false) // not a leap year
    expect(isValidDateString("")).toBe(false)
    expect(isValidDateString("2026/01/05")).toBe(false)
  })
})

describe("getDayOfWeek", () => {
  it("returns 0-6 matching DAY_NAMES (0=Sun)", () => {
    // 2026-01-04 is a Sunday
    expect(getDayOfWeek("2026-01-04")).toBe(0)
    // 2026-01-05 is a Monday
    expect(getDayOfWeek("2026-01-05")).toBe(1)
  })
})

describe("addDaysToDate", () => {
  it("adds positive and negative day deltas", () => {
    expect(addDaysToDate("2026-01-05", 1)).toBe("2026-01-06")
    expect(addDaysToDate("2026-01-05", -1)).toBe("2026-01-04")
  })

  it("rolls over month/year boundaries correctly", () => {
    expect(addDaysToDate("2026-01-31", 1)).toBe("2026-02-01")
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01")
  })
})

describe("formatDisplayDate", () => {
  it("labels today/yesterday/tomorrow relative to getTodayDate()", () => {
    const today = getTodayDate()
    const yesterday = addDaysToDate(today, -1)
    const tomorrow = addDaysToDate(today, 1)
    expect(formatDisplayDate(today)).toBe("Today")
    expect(formatDisplayDate(yesterday)).toBe("Yesterday")
    expect(formatDisplayDate(tomorrow)).toBe("Tomorrow")
  })

  it("falls back to a weekday/month/day string for other dates", () => {
    const farAway = addDaysToDate(getTodayDate(), 30)
    const result = formatDisplayDate(farAway)
    expect(result).not.toBe("Today")
    expect(result).not.toBe("Yesterday")
    expect(result).not.toBe("Tomorrow")
    expect(result.length).toBeGreaterThan(0)
  })
})
