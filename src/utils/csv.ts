// src/utils/csv.ts
// Converts attendance records to/from a simple, human-editable CSV format.
//
// Columns: date,lectureId,subject,startTime,status
// - date/startTime/status are authoritative and used to reconstruct records.
// - lectureId/subject are exported for readability/reference only, and are
//   NOT read back in on import. Lecture ids are regenerated every time the
//   master timetable is (re)imported (see timetableImport.ts), so an id
//   captured in an old export can silently point at nothing by the time you
//   import it back - which used to make those rows vanish. Instead, each row
//   is re-matched against the CURRENT timetable by (day-of-week of `date`,
//   `startTime`), the same grouping the Today screen already uses to decide
//   which lectures exist on a given date. If no master lecture matches, the
//   row is matched against one-off extra classes (added on the Today tab)
//   by exact `date` + `startTime`. `lectureId` in the file is never trusted
//   for lookup - only the id resolved this way is ever written to storage,
//   and only used afterward for the normal save/dedupe-by-id path.
//
// Removed-for-day classes (a DayOverride with cancelled: true) are deleted
// on purpose and are deliberately NOT carried through either direction:
// exports skip their attendance rows, and imports skip any row that would
// re-create them, so they stay gone for good.
import { Attendance, AttendanceStatus, DayOverride, ExtraLecture, Lecture } from "../types"
import { isValidDateString, getDayOfWeek, toMinutes, DAY_TIME_RE } from "./dateHelpers"

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

// `overrides`/`extraLectures` are optional and default to none, so existing
// callers/tests that only care about the master timetable keep working
// unchanged. Pass `overrides` (e.g. from getAllOverrides()) so a day's
// edited subject/startTime - not just the master lecture's - shows up in the
// row for that day, and so classes removed for a day (cancelled: true) are
// left out entirely. Pass `extraLectures` so one-off added classes resolve
// their subject/startTime instead of exporting empty cells. The override's
// own `date` is matched against `a.date`, not "today", since an override
// written while backfilling a past/future day is still valid for that day
// even after it's no longer the day being viewed.
export const attendanceToCsv = (
  attendance: Attendance[],
  lectures: Lecture[],
  overrides: DayOverride[] = [],
  extraLectures: ExtraLecture[] = []
): string => {
  const lectureById = new Map(lectures.map(l => [l.id, l]))
  const extraById = new Map(extraLectures.map(e => [e.id, e]))
  const overrideByKey = new Map(overrides.map(o => [`${o.lectureId}|${o.date}`, o]))
  // A class removed for that day was deleted on purpose - there's no point
  // carrying its (already-deleted) attendance through an export.
  const removedKeys = new Set(
    overrides.filter(o => o.cancelled).map(o => `${o.lectureId}|${o.date}`)
  )

  const rows = [...attendance]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter(a => !removedKeys.has(`${a.lectureId}|${a.date}`))
    .map(a => {
      const lecture = lectureById.get(a.lectureId)
      const extra = extraById.get(a.lectureId)
      const override = overrideByKey.get(`${a.lectureId}|${a.date}`)
      return [
        a.date,
        a.lectureId,
        override?.subject ?? lecture?.subject ?? extra?.subject ?? "",
        override?.startTime ?? lecture?.startTime ?? extra?.startTime ?? "",
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

// Parses pasted/edited CSV text back into Attendance records, resolving each
// row against `lectures` (the CURRENT master timetable) by day-of-week +
// startTime rather than trusting the file's own lectureId column - see the
// header comment for why. Rows that match no master lecture fall through to
// `extraLectures` (one-off classes added on the Today tab) matched by exact
// date + startTime. Rows for a class that was removed for that day (a
// cancelled DayOverride in `overrides`) are skipped so a removal isn't
// undone by re-importing old data. Invalid or unresolvable rows are skipped
// rather than failing the whole import, since a hand-edited file - or one
// exported before the timetable last changed - will often have at least one
// row that no longer lines up.
export const parseAttendanceCsv = (
  csvText: string,
  lectures: Lecture[] = [],
  extraLectures: ExtraLecture[] = [],
  overrides: DayOverride[] = []
): CsvImportResult => {
  const lines = csvText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length === 0) {
    return { ok: false, error: "That's empty. Paste CSV content with a header row and at least one data row." }
  }

  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase())
  const dateIdx = header.indexOf("date")
  const startTimeIdx = header.indexOf("starttime")
  const statusIdx = header.indexOf("status")
  const subjectIdx = header.indexOf("subject")

  if (dateIdx === -1 || startTimeIdx === -1 || statusIdx === -1) {
    return {
      ok: false,
      error: `Missing required columns. Expected a header row like: ${CSV_HEADER}`
    }
  }

  // A class removed for a day (cancelled override) must stay deleted even if
  // an old export that still contains it is pasted back in.
  const removedKeys = new Set(
    overrides.filter(o => o.cancelled).map(o => `${o.lectureId}|${o.date}`)
  )

  const entries: Attendance[] = []
  const skippedReasons: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i])
    const rowNum = i + 1 // 1-indexed, matches what a user sees in a spreadsheet

    const date = (fields[dateIdx] ?? "").trim()
    const startTime = (fields[startTimeIdx] ?? "").trim()
    const statusRaw = (fields[statusIdx] ?? "").trim().toLowerCase()
    const subject = subjectIdx === -1 ? "" : (fields[subjectIdx] ?? "").trim()

    if (!isValidDateString(date)) {
      skippedReasons.push(`Row ${rowNum}: invalid date "${date}" (expected YYYY-MM-DD)`)
      continue
    }
    if (!DAY_TIME_RE.test(startTime)) {
      skippedReasons.push(`Row ${rowNum}: invalid startTime "${startTime}" (expected H:MM or HH:MM)`)
      continue
    }
    if (!VALID_STATUSES.includes(statusRaw as AttendanceStatus)) {
      skippedReasons.push(`Row ${rowNum}: invalid status "${statusRaw}" (expected present/absent/cancelled)`)
      continue
    }

    // Which lectures actually happen on this date, by weekday - the same
    // grouping TodayScreen uses. Matched further by startTime, since a day
    // can have several lectures.
    const weekday = getDayOfWeek(date)
    const startMinutes = toMinutes(startTime)
    let candidates = lectures.filter(l => l.day === weekday && toMinutes(l.startTime) === startMinutes)

    // Same day+time slot occupied by more than one current lecture (data
    // oddity, not expected in normal use) - narrow using subject if we have
    // one to go on.
    if (candidates.length > 1 && subject) {
      const bySubject = candidates.filter(l => l.subject.toLowerCase() === subject.toLowerCase())
      if (bySubject.length > 0) candidates = bySubject
    }

    if (candidates.length === 1) {
      const lecture = candidates[0]
      // A class removed for that day must not be resurrected by re-importing
      // an old export - skip it, matching the removal's own data purge.
      if (removedKeys.has(`${lecture.id}|${date}`)) {
        skippedReasons.push(`Row ${rowNum}: ${lecture.subject} was removed for that day (${date}) - skipped`)
        continue
      }
      entries.push({
        id: `csv-${date}-${lecture.id}-${Date.now()}-${i}`,
        date,
        lectureId: lecture.id,
        status: statusRaw as AttendanceStatus
      })
      continue
    }
    if (candidates.length > 1) {
      skippedReasons.push(`Row ${rowNum}: ${candidates.length} lectures match ${startTime} that day (${date}) - ambiguous, add/fix the subject column to disambiguate`)
      continue
    }

    // No master lecture at that time - maybe it's a one-off extra class
    // added on the Today tab for this exact date.
    const extraCandidates = extraLectures.filter(
      e => e.date === date && toMinutes(e.startTime) === startMinutes
    )
    if (extraCandidates.length === 1) {
      entries.push({
        id: `csv-${date}-${extraCandidates[0].id}-${Date.now()}-${i}`,
        date,
        lectureId: extraCandidates[0].id,
        status: statusRaw as AttendanceStatus
      })
      continue
    }
    if (extraCandidates.length > 1) {
      skippedReasons.push(`Row ${rowNum}: ${extraCandidates.length} added classes match ${startTime} on ${date} - ambiguous`)
      continue
    }

    skippedReasons.push(`Row ${rowNum}: no lecture on your current timetable at ${startTime} that day (${date})`)
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
