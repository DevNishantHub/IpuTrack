import AsyncStorage from "@react-native-async-storage/async-storage"
import { calculateStats, calculateBunkInfo, getAttendanceTrend, checkLowAttendanceAndNotify } from "../attendance"
import { Attendance, Lecture } from "../../types"
import {
  setAttendanceThreshold,
  setSubjectThreshold,
  wasLowAttendanceNotified,
  setLowAttendanceNotified
} from "../../storage/storage"
import * as Notifications from "expo-notifications"

afterEach(async () => {
  await AsyncStorage.clear()
  jest.restoreAllMocks()
})

const lecture = (id: string, subject: string, day = 1, startTime = "09:00"): Lecture => ({
  id, subject, day, startTime
})
const record = (id: string, lectureId: string, date: string, status: Attendance["status"]): Attendance => ({
  id, lectureId, date, status
})

describe("calculateStats - additional edge cases", () => {
  it("returns 100% when everything is present", () => {
    const stats = calculateStats([
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l1", "2026-01-02", "present")
    ])
    expect(stats.percentage).toBe(100)
  })

  it("returns 0% when everything is absent", () => {
    const stats = calculateStats([
      record("1", "l1", "2026-01-01", "absent"),
      record("2", "l1", "2026-01-02", "absent")
    ])
    expect(stats.percentage).toBe(0)
  })

  it("cancelled-only records never divide by zero and never appear in present/absent", () => {
    const stats = calculateStats([
      record("1", "l1", "2026-01-01", "cancelled"),
      record("2", "l1", "2026-01-02", "cancelled")
    ])
    expect(stats).toEqual({ present: 0, absent: 0, cancelled: 2, percentage: 0 })
  })

  it("counts are internally consistent: present+absent+cancelled equals input length", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l1", "2026-01-02", "absent"),
      record("3", "l1", "2026-01-03", "cancelled"),
      record("4", "l1", "2026-01-04", "present")
    ]
    const stats = calculateStats(attendance)
    expect(stats.present + stats.absent + stats.cancelled).toBe(attendance.length)
  })

  it("is order-independent (same records, different order -> same stats)", () => {
    const a = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l1", "2026-01-02", "absent")
    ]
    const b = [a[1], a[0]]
    expect(calculateStats(a)).toEqual(calculateStats(b))
  })
})

describe("calculateBunkInfo - additional edge cases", () => {
  const lectures = [
    lecture("l1", "Math"), lecture("l2", "Math"), lecture("l3", "Math"), lecture("l4", "Math")
  ]

  it("mustAttend never exceeds futureClasses even for a very low threshold-vs-attendance gap", () => {
    const bigLectureSet = Array.from({ length: 20 }, (_, i) => lecture(`l${i}`, "Math"))
    const attendance = [
      record("1", "l0", "2026-01-01", "absent"),
      record("2", "l1", "2026-01-02", "absent")
    ]
    const result = calculateBunkInfo(attendance, bigLectureSet, "Math", 90)
    const futureClasses = 20 - 2
    expect(result.mustAttend).toBeLessThanOrEqual(futureClasses)
  })

  it("canSkip never exceeds remaining future classes", () => {
    const attendance = [record("1", "l1", "2026-01-01", "present")]
    const result = calculateBunkInfo(attendance, lectures, "Math", 10)
    const futureClasses = lectures.length - 1
    expect(result.canSkip).toBeLessThanOrEqual(futureClasses)
  })

  it("canSkip is never negative", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "absent"),
      record("2", "l2", "2026-01-02", "absent")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 95)
    expect(result.canSkip).toBeGreaterThanOrEqual(0)
  })

  it("only counts attendance rows whose lectureId belongs to the requested subject", () => {
    const mixedLectures = [lecture("l1", "Math"), lecture("l2", "Physics")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent") // different subject, must be ignored
    ]
    const result = calculateBunkInfo(attendance, mixedLectures, "Math", 75)
    expect(result.currentPct).toBe(100)
  })

  it("ignores cancelled lectures when computing attendedClasses/currentPct", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "cancelled")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75)
    // attendedClasses = present+absent = 1 (cancelled excluded)
    expect(result.currentPct).toBe(100)
  })

  it("exactly-at-threshold percentage requires no further mustAttend", () => {
    // 3 present, 1 absent = 75% exactly at a 75 threshold
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "present"),
      record("3", "l3", "2026-01-03", "present"),
      record("4", "l4", "2026-01-04", "absent")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75)
    expect(result.currentPct).toBe(75)
    expect(result.mustAttend).toBe(0)
  })
})

describe("getAttendanceTrend - additional edge cases", () => {
  const lectures = [lecture("l1", "Math"), lecture("l2", "Math")]

  it("multiple records on the same date are folded into one cumulative point, not two", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-01", "absent")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend).toHaveLength(1)
    expect(trend[0].percentage).toBe(50)
  })

  it("cancelled records don't move the cumulative percentage but the date can still appear if paired with a valid record", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "cancelled"),
      record("2", "l2", "2026-01-01", "present")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend[0].percentage).toBe(100)
  })

  it("trend is monotonic in date order regardless of input array order", () => {
    const attendance = [
      record("3", "l1", "2026-01-03", "present"),
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    const dates = trend.map(t => t.date)
    expect(dates).toEqual([...dates].sort())
  })

  it("semesterStartDate filter is inclusive of the boundary date itself", () => {
    const attendance = [record("1", "l1", "2026-01-01", "present")]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend).toHaveLength(1)
  })
})

describe("calculateBunkInfo - one-off extra classes", () => {
  const lectures = [
    lecture("l1", "Math"), lecture("l2", "Math"), lecture("l3", "Math"), lecture("l4", "Math")
  ]

  it("counts extra-class attendance toward the percentage and skip/attend math (canSkip stays correct)", () => {
    // 1 master present + 2 extra presents, 1 master absent -> 75%
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent"),
      record("3", "math-2026-01-03-10-00", "2026-01-03", "present"),
      record("4", "math-2026-01-04-10-00", "2026-01-04", "present")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75, [
      "math-2026-01-03-10-00",
      "math-2026-01-04-10-00"
    ])
    expect(result.currentPct).toBe(75)
    // 3 present / 4 attended = 75% exactly: skipping even one class drops to
    // 3/5 = 60%, so canSkip must be 0 even though future master classes remain.
    expect(result.canSkip).toBe(0)
    // At threshold with master future classes remaining -> mustAttend 0
    expect(result.mustAttend).toBe(0)
  })

  it("extra absents also count toward mustAttend (not just master absents)", () => {
    // Master: 1 present + 1 absent. Extras: 1 present + 1 absent -> 50% overall.
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent"),
      record("3", "math-2026-01-03-10-00", "2026-01-03", "present"),
      record("4", "math-2026-01-04-10-00", "2026-01-04", "absent")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75, [
      "math-2026-01-03-10-00",
      "math-2026-01-04-10-00"
    ])
    expect(result.currentPct).toBe(50)
    // 2 master classes remain: attend both to reach 4/6 = 66.7% (best possible),
    // so mustAttend must reflect the extra absent, not just the master one.
    expect(result.mustAttend).toBe(2)
  })

  it("extras never inflate the remaining-future-classes count", () => {
    // All 4 master classes attended + 1 extra: there are no master classes
    // left to skip, so canSkip must stay 0 even though present-heavy extras
    // would otherwise suggest room to skip.
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "present"),
      record("3", "l3", "2026-01-03", "present"),
      record("4", "l4", "2026-01-04", "present"),
      record("5", "math-2026-01-05-10-00", "2026-01-05", "present")
    ]
    const result = calculateBunkInfo(attendance, lectures, "Math", 75, ["math-2026-01-05-10-00"])
    expect(result.canSkip).toBe(0)
  })

  it("extra-only subject (no master lectures) has no future classes to plan around", () => {
    const attendance = [
      record("1", "ai-2026-01-06-8-30", "2026-01-06", "present"),
      record("2", "ai-2026-01-07-8-30", "2026-01-07", "absent")
    ]
    const result = calculateBunkInfo(attendance, [], "AI", 75, ["ai-2026-01-06-8-30", "ai-2026-01-07-8-30"])
    // No master classes -> nothing to skip or attend; the screen shows the
    // extras' percentage from calculateStats instead (bunk's currentPct is
    // only meaningful when master classes exist).
    expect(result.canSkip).toBe(0)
    expect(result.mustAttend).toBe(0)
  })
})

describe("getAttendanceTrend - one-off extra classes", () => {
  const lectures = [lecture("l1", "Math"), lecture("l2", "Math")]

  it("includes extra-class attendance in the cumulative percentage", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "math-2026-01-02-10-00", "2026-01-02", "absent")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01", ["math-2026-01-02-10-00"])
    expect(trend).toHaveLength(2)
    expect(trend[0].percentage).toBe(100)
    expect(trend[1].percentage).toBe(50)
  })

  it("without extra ids, extra-class attendance stays excluded (backward compatible)", () => {
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "math-2026-01-02-10-00", "2026-01-02", "absent")
    ]
    const trend = getAttendanceTrend(attendance, lectures, "Math", "2026-01-01")
    expect(trend).toHaveLength(1)
    expect(trend[0].percentage).toBe(100)
  })
})

describe("checkLowAttendanceAndNotify - storage & notification integration", () => {
  it("does nothing when the lecture id doesn't exist", async () => {
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("missing-lecture", [], [])
    expect(spy).not.toHaveBeenCalled()
  })

  it("does nothing when there's no present/absent data yet for the subject", async () => {
    const lectures = [lecture("l1", "Math")]
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("l1", lectures, [record("1", "l1", "2026-01-01", "cancelled")])
    expect(spy).not.toHaveBeenCalled()
  })

  it("notifies once when attendance drops below the effective threshold", async () => {
    await setAttendanceThreshold(75)
    const lectures = [lecture("l1", "Math"), lecture("l2", "Math"), lecture("l3", "Math"), lecture("l4", "Math")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent"),
      record("3", "l3", "2026-01-03", "absent"),
      record("4", "l4", "2026-01-04", "absent")
    ]
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(await wasLowAttendanceNotified("Math")).toBe(true)
  })

  it("does not re-notify on a second call while still below threshold (notified flag prevents spam)", async () => {
    await setAttendanceThreshold(75)
    const lectures = [lecture("l1", "Math"), lecture("l2", "Math")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent")
    ]
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("resets the notified flag once attendance recovers above threshold", async () => {
    await setAttendanceThreshold(75)
    await setLowAttendanceNotified("Math", true)
    const lectures = [lecture("l1", "Math"), lecture("l2", "Math"), lecture("l3", "Math"), lecture("l4", "Math")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "present"),
      record("3", "l3", "2026-01-03", "present"),
      record("4", "l4", "2026-01-04", "present")
    ]
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(await wasLowAttendanceNotified("Math")).toBe(false)
  })

  it("uses the per-subject threshold override instead of the global one when set", async () => {
    await setAttendanceThreshold(50) // globally lenient
    await setSubjectThreshold("Math", 95) // strict override for Math
    const lectures = [lecture("l1", "Math"), lecture("l2", "Math")]
    // 50% attendance: passes global 50 threshold but fails Math's 95 override
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "absent")
    ]
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("does not flip the notified flag for an unrelated subject", async () => {
    await setAttendanceThreshold(75)
    await setLowAttendanceNotified("Physics", true)
    const lectures = [lecture("l1", "Math"), lecture("l2", "Math"), lecture("l3", "Math"), lecture("l4", "Math")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"),
      record("2", "l2", "2026-01-02", "present"),
      record("3", "l3", "2026-01-03", "present"),
      record("4", "l4", "2026-01-04", "present")
    ]
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(await wasLowAttendanceNotified("Physics")).toBe(true)
  })

  it("only considers attendance for lectures matching the subject, ignoring other subjects' records", async () => {
    await setAttendanceThreshold(75)
    const lectures = [lecture("l1", "Math"), lecture("l2", "Physics")]
    const attendance = [
      record("1", "l1", "2026-01-01", "present"), // Math: 100%
      record("2", "l2", "2026-01-02", "absent")   // Physics: 0%, must not drag Math down
    ]
    const spy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await checkLowAttendanceAndNotify("l1", lectures, attendance)
    expect(spy).not.toHaveBeenCalled()
  })
})
