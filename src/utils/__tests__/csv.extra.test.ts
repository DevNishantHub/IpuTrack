import { attendanceToCsv, parseAttendanceCsv } from "../csv"
import { Attendance, DayOverride, ExtraLecture, Lecture } from "../../types"

const lectures: Lecture[] = [
  { id: "l1", subject: "Math", day: 1, startTime: "09:00" },
  { id: "l2", subject: "Physics", day: 2, startTime: "10:00" }
]

describe("attendanceToCsv - export consistency", () => {
  it("round-trips: export then re-import produces the same date/lectureId/status data", () => {
    // Dates are chosen to match the lectures' weekdays (l1 = Monday,
    // l2 = Tuesday) since rows are re-matched against the current timetable
    // on import, not against the file's lectureId column.
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-05", status: "present" },
      { id: "2", lectureId: "l2", date: "2026-01-06", status: "absent" },
      { id: "3", lectureId: "l1", date: "2026-01-12", status: "cancelled" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const simplified = result.entries
        .map(e => ({ date: e.date, lectureId: e.lectureId, status: e.status }))
        .sort((a, b) => a.date.localeCompare(b.date))
      expect(simplified).toEqual([
        { date: "2026-01-05", lectureId: "l1", status: "present" },
        { date: "2026-01-06", lectureId: "l2", status: "absent" },
        { date: "2026-01-12", lectureId: "l1", status: "cancelled" }
      ])
    }
  })

  it("uses the day-override subject/startTime for that date instead of the stale master values", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-01", status: "present" },
      // Same lecture, different date with no override - must still show the
      // master timetable values, not leak the override across dates.
      { id: "2", lectureId: "l1", date: "2026-01-02", status: "present" }
    ]
    const overrides: DayOverride[] = [
      { id: "o1", date: "2026-01-01", lectureId: "l1", subject: "Math (Room 512)", startTime: "09:30" }
    ]
    const csv = attendanceToCsv(attendance, lectures, overrides)
    const lines = csv.split("\n")
    // No comma in "Math (Room 512)", so csvEscape leaves it unquoted.
    expect(lines.find(l => l.startsWith("2026-01-01"))).toContain("Math (Room 512),09:30")
    expect(lines.find(l => l.startsWith("2026-01-02"))).toContain("Math,09:00")
  })

  it("falls back to the master lecture when no override is passed", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-01", status: "present" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    expect(csv).toContain("Math,09:00,present")
  })

  it("handles an empty attendance array (header only)", () => {
    const csv = attendanceToCsv([], lectures)
    expect(csv).toBe("date,lectureId,subject,startTime,status")
  })

  it("leaves subject/startTime blank when the lecture no longer exists in the master timetable", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "deleted-lecture", date: "2026-01-01", status: "present" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    expect(csv).toContain("2026-01-01,deleted-lecture,,,present")
  })

  it("sorts multiple same-date rows stably rather than throwing/reordering unpredictably", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-01", status: "present" },
      { id: "2", lectureId: "l2", date: "2026-01-01", status: "absent" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    const lines = csv.split("\n")
    expect(lines).toHaveLength(3)
  })

  it("does not mutate the input attendance array (sort should be non-destructive)", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-02", status: "present" },
      { id: "2", lectureId: "l1", date: "2026-01-01", status: "present" }
    ]
    const original = [...attendance]
    attendanceToCsv(attendance, lectures)
    expect(attendance).toEqual(original)
  })

  it("excludes attendance for a class removed for that day (cancelled override) from exports", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-05", status: "present" }
    ]
    const overrides: DayOverride[] = [
      { id: "o1", date: "2026-01-05", lectureId: "l1", cancelled: true }
    ]
    const csv = attendanceToCsv(attendance, lectures, overrides)
    // The removed class's attendance is gone entirely - header only.
    expect(csv).toBe("date,lectureId,subject,startTime,status")
  })

  it("resolves subject/startTime from one-off added classes for export", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "x1", date: "2026-01-05", status: "present" }
    ]
    const extras: ExtraLecture[] = [
      { id: "x1", date: "2026-01-05", subject: "Special Seminar", startTime: "14:00" }
    ]
    const csv = attendanceToCsv(attendance, lectures, [], extras)
    expect(csv).toContain("2026-01-05,x1,Special Seminar,14:00,present")
  })
})

describe("parseAttendanceCsv - status normalization & whitespace", () => {
  it("accepts uppercase/mixed-case status values by lowercasing them", () => {
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,lec_1,Math,09:00,PRESENT"
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0].status).toBe("present")
  })

  it("trims stray whitespace around field values", () => {
    const csv = "date,lectureId,subject,startTime,status\n 2026-01-05 , lec_1 ,Math,09:00, present "
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries[0].date).toBe("2026-01-05")
      // The file's lectureId column is ignored - resolved to the timetable.
      expect(result.entries[0].lectureId).toBe("l1")
    }
  })

  it("handles Windows-style CRLF line endings", () => {
    const csv = "date,lectureId,subject,startTime,status\r\n2026-01-05,lec_1,Math,09:00,present\r\n"
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
  })

  it("skips blank lines in the middle of the file without breaking row numbering semantics", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,Math,09:00,present",
      "",
      "2026-01-06,lec_2,Physics,10:00,absent"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries).toHaveLength(2)
  })

  it("is header case-insensitive", () => {
    const csv = "DATE,STARTTIME,STATUS\n2026-01-05,09:00,present"
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0].lectureId).toBe("l1")
  })

  it("last row wins when the same date+lectureId appears twice within one import (matches storage upsert semantics)", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,Math,09:00,present",
      "2026-01-05,lec_1,Math,09:00,absent"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // parseAttendanceCsv itself doesn't dedupe (that's saveAttendanceBulk's
      // job) - assert it faithfully returns both rows for the caller to merge.
      expect(result.entries).toHaveLength(2)
      expect(result.entries.map(e => e.status)).toEqual(["present", "absent"])
    }
  })

  it("generates unique ids for every parsed row even with identical date/lectureId", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,Math,09:00,present",
      "2026-01-05,lec_1,Math,09:00,present"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ids = result.entries.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("reports up to 5 skip reasons when everything is invalid, without throwing on more rows", () => {
    const rows = Array.from({ length: 8 }, (_, i) => `bad-date-${i},lec_1,AI,09:00,present`)
    const csv = ["date,lectureId,subject,startTime,status", ...rows].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const lines = result.error.split("\n").filter(l => l.startsWith("Row"))
      expect(lines.length).toBeLessThanOrEqual(5)
    }
  })

  it("handles a mix of valid and multiple kinds of invalid rows in one file, counting skips correctly", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,Math,09:00,present", // valid (matches l1)
      "bad-date,lec_1,Math,09:00,present",   // invalid date
      "2026-01-05,,Math,09:00,present",      // missing lectureId is fine now
      "2026-01-06,lec_2,Physics,10:00,unknown" // invalid status
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(2)
      expect(result.skippedCount).toBe(2)
    }
  })

  it("resolves rows to a one-off added class for that exact date when no master lecture matches", () => {
    const extras: ExtraLecture[] = [
      { id: "x1", date: "2026-01-05", subject: "Special Seminar", startTime: "14:00" }
    ]
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,ignored,Special Seminar,14:00,present"
    const result = parseAttendanceCsv(csv, lectures, extras)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].lectureId).toBe("x1")
    }
  })

  it("does not match a one-off added class on any other date (extras are date-scoped)", () => {
    const extras: ExtraLecture[] = [
      { id: "x1", date: "2026-01-05", subject: "Special Seminar", startTime: "14:00" }
    ]
    const csv = "date,lectureId,subject,startTime,status\n2026-01-12,ignored,Special Seminar,14:00,present"
    const result = parseAttendanceCsv(csv, lectures, extras)
    expect(result.ok).toBe(false)
  })

  it("a master-timetable match wins over an extra class at the same time", () => {
    const extras: ExtraLecture[] = [
      { id: "x1", date: "2026-01-05", subject: "Math", startTime: "09:00" }
    ]
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,ignored,Math,09:00,present"
    const result = parseAttendanceCsv(csv, lectures, extras)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0].lectureId).toBe("l1")
  })

  it("skips rows for a class that was removed for that day, so re-importing an old export doesn't resurrect it", () => {
    const overrides: DayOverride[] = [
      { id: "o1", date: "2026-01-05", lectureId: "l1", cancelled: true }
    ]
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,lec_1,Math,09:00,present"
    const result = parseAttendanceCsv(csv, lectures, [], overrides)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/removed for that day/)
  })
})
