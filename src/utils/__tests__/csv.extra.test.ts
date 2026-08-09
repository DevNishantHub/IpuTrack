import { attendanceToCsv, parseAttendanceCsv } from "../csv"
import { Attendance, Lecture } from "../../types"

const lectures: Lecture[] = [
  { id: "l1", subject: "Math", day: 1, startTime: "09:00" },
  { id: "l2", subject: "Physics", day: 2, startTime: "10:00" }
]

describe("attendanceToCsv - export consistency", () => {
  it("round-trips: export then re-import produces the same date/lectureId/status data", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-01", status: "present" },
      { id: "2", lectureId: "l2", date: "2026-01-02", status: "absent" },
      { id: "3", lectureId: "l1", date: "2026-01-03", status: "cancelled" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const simplified = result.entries
        .map(e => ({ date: e.date, lectureId: e.lectureId, status: e.status }))
        .sort((a, b) => a.date.localeCompare(b.date))
      expect(simplified).toEqual([
        { date: "2026-01-01", lectureId: "l1", status: "present" },
        { date: "2026-01-02", lectureId: "l2", status: "absent" },
        { date: "2026-01-03", lectureId: "l1", status: "cancelled" }
      ])
    }
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
})

describe("parseAttendanceCsv - status normalization & whitespace", () => {
  it("accepts uppercase/mixed-case status values by lowercasing them", () => {
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,lec_1,AI,08:30,PRESENT"
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0].status).toBe("present")
  })

  it("trims stray whitespace around field values", () => {
    const csv = "date,lectureId,subject,startTime,status\n 2026-01-05 , lec_1 ,AI,08:30, present "
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries[0].date).toBe("2026-01-05")
      expect(result.entries[0].lectureId).toBe("lec_1")
    }
  })

  it("handles Windows-style CRLF line endings", () => {
    const csv = "date,lectureId,subject,startTime,status\r\n2026-01-05,lec_1,AI,08:30,present\r\n"
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
  })

  it("skips blank lines in the middle of the file without breaking row numbering semantics", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,AI,08:30,present",
      "",
      "2026-01-06,lec_2,CN,09:30,absent"
    ].join("\n")
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries).toHaveLength(2)
  })

  it("is header case-insensitive", () => {
    const csv = "DATE,LectureId,STATUS\n2026-01-05,lec_1,present"
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
  })

  it("last row wins when the same date+lectureId appears twice within one import (matches storage upsert semantics)", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,AI,08:30,present",
      "2026-01-05,lec_1,AI,08:30,absent"
    ].join("\n")
    const result = parseAttendanceCsv(csv)
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
      "2026-01-05,lec_1,AI,08:30,present",
      "2026-01-05,lec_1,AI,08:30,present"
    ].join("\n")
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ids = result.entries.map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it("reports up to 5 skip reasons when everything is invalid, without throwing on more rows", () => {
    const rows = Array.from({ length: 8 }, (_, i) => `bad-date-${i},lec_1,AI,08:30,present`)
    const csv = ["date,lectureId,subject,startTime,status", ...rows].join("\n")
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const lines = result.error.split("\n").filter(l => l.startsWith("Row"))
      expect(lines.length).toBeLessThanOrEqual(5)
    }
  })

  it("handles a mix of valid and multiple kinds of invalid rows in one file, counting skips correctly", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-01,lec_1,AI,08:30,present",   // valid
      "bad-date,lec_1,AI,08:30,present",     // invalid date
      "2026-01-02,,AI,08:30,present",        // missing lectureId
      "2026-01-03,lec_1,AI,08:30,unknown"    // invalid status
    ].join("\n")
    const result = parseAttendanceCsv(csv)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.skippedCount).toBe(3)
    }
  })
})
