// src/utils/csv.ts
// Converts attendance records to/from a simple, human-editable CSV format.
//
// Columns: date,lectureId,subject,startTime,status
// - date/lectureId/status are authoritative and used to reconstruct records.
// - subject/startTime are included only for readability when someone opens
//   the file in a spreadsheet - they're informational, not read back in, so
//   editing them by hand doesn't affect anything (edit `status` instead).
import { Attendance, AttendanceStatus, Lecture } from "../types"
import { isValidDateString } from "./dateHelpers"

const CSV_HEADER = "date,lectureId,subject,startTime,status"
const VALID_STATUSES: AttendanceStatus[] = ["present", "absent", "cancelled"]

// Wraps a field in quotes and escapes internal quotes only if needed, so
// simple values stay clean and readable in a spreadsheet.
const csvEscape = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Splits a single CSV line into fields, respecting quoted fields that may
// contain commas. Good enough for the simple, mostly-numeric/text data here.
const splitCsvLine = (line: string): string[] => {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ",") {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields
}

export const attendanceToCsv = (attendance: Attendance[], lectures: Lecture[]): string => {
  const lectureById = new Map(lectures.map(l => [l.id, l]))

  const rows = [...attendance]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(a => {
      const lecture = lectureById.get(a.lectureId)
      return [
        a.date,
        a.lectureId,
        lecture?.subject ?? "",
        lecture?.startTime ?? "",
        a.status
      ]
        .map(v => csvEscape(String(v)))
        .join(",")
    })

  return [CSV_HEADER, ...rows].join("\n")
}

export type CsvImportResult =
  | { ok: true; entries: Attendance[]; skippedCount: number; skippedReasons: string[] }
  | { ok: false; error: string }

// Parses pasted/edited CSV text back into Attendance records. Invalid rows
// (bad date, unrecognized status, missing lectureId) are skipped rather than
// failing the whole import, since a hand-edited file will often have at
// least one typo - the caller can surface skippedReasons to the user.
export const parseAttendanceCsv = (csvText: string): CsvImportResult => {
  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return { ok: false, error: "That's empty. Paste CSV content with a header row and at least one data row." }
  }

  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  const dateIdx = header.indexOf("date")
  const lectureIdIdx = header.indexOf("lectureid")
  const statusIdx = header.indexOf("status")

  if (dateIdx === -1 || lectureIdIdx === -1 || statusIdx === -1) {
    return {
      ok: false,
      error: `Missing required columns. Expected a header row like: ${CSV_HEADER}`
    }
  }

  const entries: Attendance[] = []
  const skippedReasons: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    const rowNum = i + 1 // 1-indexed, matches what a user sees in a spreadsheet

    const date = (fields[dateIdx] ?? "").trim()
    const lectureId = (fields[lectureIdIdx] ?? "").trim()
    const statusRaw = (fields[statusIdx] ?? "").trim().toLowerCase()

    if (!isValidDateString(date)) {
      skippedReasons.push(`Row ${rowNum}: invalid date "${date}" (expected YYYY-MM-DD)`)
      continue
    }
    if (!lectureId) {
      skippedReasons.push(`Row ${rowNum}: missing lectureId`)
      continue
    }
    if (!VALID_STATUSES.includes(statusRaw as AttendanceStatus)) {
      skippedReasons.push(`Row ${rowNum}: invalid status "${statusRaw}" (expected present/absent/cancelled)`)
      continue
    }

    entries.push({
      id: `csv-${date}-${lectureId}-${Date.now()}-${i}`,
      date,
      lectureId,
      status: statusRaw as AttendanceStatus
    })
  }

  if (entries.length === 0) {
    return {
      ok: false,
      error: skippedReasons.length > 0
        ? `No valid rows found.\n${skippedReasons.slice(0, 5).join("\n")}`
        : "No data rows found."
    }
  }

  return { ok: true, entries, skippedCount: skippedReasons.length, skippedReasons }
}
