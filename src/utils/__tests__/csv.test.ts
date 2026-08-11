import { attendanceToCsv, parseAttendanceCsv } from "../csv"
import { Attendance, Lecture } from "../../types"

const lectures: Lecture[] = [
  { id: "l1", subject: "Math", day: 1, startTime: "09:00" },
  { id: "l2", subject: "Physics, Advanced", day: 2, startTime: "10:00" }
]

describe("attendanceToCsv", () => {
  it("produces a header plus one row per record, sorted by date", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l1", date: "2026-01-02", status: "present" },
      { id: "2", lectureId: "l1", date: "2026-01-01", status: "absent" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    const lines = csv.split("\n")
    expect(lines[0]).toBe("date,lectureId,subject,startTime,status")
    expect(lines[1]).toContain("2026-01-01")
    expect(lines[2]).toContain("2026-01-02")
  })

  it("quotes subjects that contain commas", () => {
    const attendance: Attendance[] = [
      { id: "1", lectureId: "l2", date: "2026-01-01", status: "present" }
    ]
    const csv = attendanceToCsv(attendance, lectures)
    expect(csv).toContain('"Physics, Advanced"')
  })
})

describe("parseAttendanceCsv", () => {
  it("round-trips a simple valid CSV, resolving the row to the current timetable", () => {
    // 2026-01-05 is a Monday; the file's lectureId (lec_1) is deliberately
    // ignored - the row is matched to Math at 09:00 on the current timetable.
    const csv = "date,lectureId,subject,startTime,status\n2026-01-05,lec_1,Math,09:00,present"
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0]).toMatchObject({
        date: "2026-01-05",
        lectureId: "l1",
        status: "present"
      })
      expect(result.skippedCount).toBe(0)
    }
  })

  it("handles quoted fields containing commas", () => {
    const csv = 'date,lectureId,subject,startTime,status\n2026-01-06,lec_2,"Physics, Advanced",10:00,present'
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entries[0].lectureId).toBe("l2")
  })

  it("handles escaped double-quotes inside quoted fields", () => {
    const csv = 'date,lectureId,subject,startTime,status\n2026-01-05,lec_1,"He said ""hi""",09:00,present'
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
  })

  it("rejects empty input", () => {
    const result = parseAttendanceCsv("", lectures)
    expect(result.ok).toBe(false)
  })

  it("rejects a header-only file with no data rows", () => {
    const result = parseAttendanceCsv("date,lectureId,subject,startTime,status", lectures)
    expect(result.ok).toBe(false)
  })

  it("rejects input missing required columns", () => {
    const result = parseAttendanceCsv("foo,bar\n1,2", lectures)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Missing required columns/)
    }
  })

  it("skips rows with invalid dates but keeps valid ones", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "not-a-date,lec_1,Math,09:00,present",
      "2026-01-05,lec_1,Math,09:00,present"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.skippedCount).toBe(1)
    }
  })

  it("skips rows with invalid status values", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,lec_1,Math,09:00,maybe"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(false)
  })

  it("accepts rows with an empty lectureId column (matched by date + startTime instead)", () => {
    const csv = [
      "date,lectureId,subject,startTime,status",
      "2026-01-05,,Math,09:00,present"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].lectureId).toBe("l1")
    }
  })

  it("ignores extra/unrecognized columns", () => {
    const csv = [
      "date,lectureId,subject,startTime,status,notes",
      "2026-01-05,lec_1,Math,09:00,present,some notes here"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
  })

  it("is column-order independent (matches header names, not position)", () => {
    const csv = [
      "status,date,starttime",
      "present,2026-01-05,09:00"
    ].join("\n")
    const result = parseAttendanceCsv(csv, lectures)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entries[0].date).toBe("2026-01-05")
      expect(result.entries[0].status).toBe("present")
      expect(result.entries[0].lectureId).toBe("l1")
    }
  })
})
