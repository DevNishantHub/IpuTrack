import { calculateStats, calculateBunkInfo, getAttendanceTrend } from "../attendance"
import { Attendance, Lecture } from "../../types"

const lecture = (id: string, subject: string, day = 1, startTime = "09:00"): Lecture => ({
  id,
  subject,
  day,
  startTime
})

const record = (id: string, lectureId: string, date: string, status: Attendance["status"]): Attendance => ({
  id,
  lectureId,
  date,
  status
})

describe("calculateStats", () => {
  it("counts present/absent/cancelled and computes percentage from valid (non-cancelled) classes", () => {
    const attendance: Attendance[] = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l1", "2026-01-02", "present"),
      record("3", "l1", "2026-01-03", "absent"),
      record("4", "l1", "2026-01-04", "cancelled")
    ]
    const stats = calculateStats(attendance)
    expect(stats.present).toBe(2)
    expect(stats.absent).toBe(1)
    expect(stats.cancelled).toBe(1)
    // percentage excludes cancelled from the denominator: 2/3
    expect(stats.percentage).toBeCloseTo((2 / 3) * 100, 5)
  })

  it("returns 0% when there are no present/absent records", () => {
    expect(calculateStats([]).percentage).toBe(0)
    expect(calculateStats([record("1", "l1", "2026-01-01", "cancelled")]).percentage).toBe(0)
  })
})

describe("calculateBunkInfo", () => {
  const lectures = [
    lecture("l1", "Math"),
    lecture("l2", "Math"),
    lecture("l3", "Math"),
    lecture("l4", "Math")
  ]

  it("returns zeros when the subject has no lectures at all", () => {
    const result = calculateBunkInfo([], [], "Nonexistent", 75)
    expect(result).toEqual({ canSkip: 0, mustAttend: 0, currentPct: 0 })
  })

  it("allows skipping future classes while comfortably above threshold", () => {
    // 4/4 attended so far (100%), threshold 75%, with lectures list extended
    // below so 4 future classes remain: floor(4*100/75 - 4) = 1 skippable.
    const extendedLectures = [
      ...lectures,
      lecture("l5", "Math"),
      lecture("l6", "Math"),
      lecture("l7", "Math"),
      lecture("l8", "Math")
    ]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "present"),
      record("3", "l3", "2026-01-03", "present"),
      record("4", "l4", "2026-01-04", "present")
    ]
    const result = calculateBunkInfo(attendance, extendedLectures, "Math", 75)
    expect(result.currentPct).toBe(100)
    expect(result.canSkip).toBe(1)
    expect(result.mustAttend).toBe(0)
  })

  it("requires attending more classes when below threshold", () => {
    // 1 present, 3 absent so far, no future classes left (4 total lectures)
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent"),
      record("3", "l3", "2026-01-03", "absent"),
      record("4", "l4", "2026-01-04", "absent")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75)
    expect(result.currentPct).toBe(25)
    // no future classes remain, so mustAttend is capped at 0 even though below threshold
    expect(result.mustAttend).toBe(0)
    expect(result.canSkip).toBe(0)
  })

  it("handles a threshold of 100 without throwing (division by 100-threshold=0 edge case)", () => {
    const attendance = [record("1", "l1", "2026-01-01", "present")]
    const result = calculateBunkInfo(attendance, lectures, "Math", 100)
    expect(Number.isFinite(result.canSkip)).toBe(true)
    // mustAttend formula divides by (100 - threshold) = 0; result should not be NaN-propagated as a crash
    expect(typeof result.mustAttend).toBe("number")
  })

  it("handles zero attendance so far", () => {
    const result = calculateBunkInfo([], lectures, "Math", 75)
    expect(result.currentPct).toBe(0)
    expect(result.canSkip).toBeGreaterThanOrEqual(0)
  })
})

describe("getAttendanceTrend", () => {
  const lectures = [lecture("l1", "Math"), lecture("l2", "Math")]

  it("produces a cumulative percentage per date, sorted ascending", () => {
    const attendance = [
      record("1", "l1", "2026-01-02", "present"),
      record("2", "l2", "2026-01-01", "absent")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend.map(t => t.date)).toEqual(["2026-01-01", "2026-01-02"])
    // Day 1: 0 present, 1 absent -> 0%
    expect(trend[0].percentage).toBe(0)
    // Day 2 cumulative: 1 present, 1 absent -> 50%
    expect(trend[1].percentage).toBe(50)
  })

  it("excludes records before the semester start date", () => {
    const attendance = [
      record("1", "l1", "2025-12-31", "present"),
      record("2", "l2", "2026-01-01", "present")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend).toHaveLength(1)
    expect(trend[0].date).toBe("2026-01-01")
  })

  it("returns an empty array when there's no attendance for the subject", () => {
    expect(getAttendanceTrend([], lectures, "Math", "2026-01-01")).toEqual([])
  })
})
