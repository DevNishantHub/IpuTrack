// src/utils/csv.ts
// Converts attendance records to/from a simple, human-editable CSV format.
//
// Columns: date,lectureId,subject,startTime,status
// - date/subject/startTime/status are authoritative on import: each date in
//   the file is treated as a COMPLETE snapshot of that day, and the file is
//   the source of truth for which classes happened and how they went.
// - lectureId is exported for reference only and NEVER read back in on
//   import. Lecture ids are regenerated every time the master timetable is
//   (re)imported (see timetableImport.ts), so an id captured in an old
//   export can silently point at nothing by the time you import it back.
//   Instead each row is resolved against the CURRENT timetable by subject
//   (+ day-of-week of `date`): a row attaches to the master class with the
//   same subject that day (tolerating a trailing lab-room number, so "AI Lab"
//   attaches to the "AI Lab 4" master class), or becomes a one-off class for
//   that exact date if no such class exists. `subject` decides, so a row is
//   never silently attached to a differently-named class.
//
// On import (see storage.applyCsvDayPlans) each date in the file is rebuilt
// to match it exactly: listed classes are marked with their status, master
// classes that day which aren't listed are removed for that day, and rows
// matching no master class are added as one-off classes. Exports already
// skip classes removed for a day, so export -> import is a faithful
// round-trip that reproduces each day as it was.
import { Attendance, AttendanceStatus, DayOverride, ExtraLecture, Lecture } from "../types"
import { isValidDateString, getDayOfWeek, toMinutes, DAY_TIME_RE } from "./dateHelpers"
import { slugifyId, timeTokenForId } from "./timetableImport"

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

export type CsvDayPlan = {
  date: string
  // Attendance rows resolved for this date (deterministic lectureId-date ids).
  attendance: Attendance[]
  // Master lectures the CSV explicitly lists for this date (matched by
  // subject). Anything else scheduled that day is treated as removed for
  // the day when the plan is applied.
  coveredLectureIds: string[]
  // For covered master lectures the CSV lists at a different time - a
  // time-move for that day only, written as a day override.
  timeOverrides: DayOverride[]
  // One-off classes the CSV defines that match no master lecture - created
  // for that exact date only (id: subject-date-time).
  extraLectures: ExtraLecture[]
}

export type CsvImportResult =
  | { ok: true; dayPlans: CsvDayPlan[]; entries: Attendance[]; skippedCount: number; skippedReasons: string[] }
  | { ok: false; error: string }

// Normalizes a subject for comparison. Besides the usual trim/case and
// trailing-sentence-punctuation tolerance, a trailing LAB-ROOM number is
// stripped ("AI Lab 4" -> "AI Lab"), so "AI Lab" and "AI Lab 4" are the
// same subject - while "AI" (theory) and "AI Lab 4" (lab) stay distinct,
// and numeric course codes like "Math 101" are never touched.
export const normalizeSubject = (value: string): string => {
  const base = value.trim().toLowerCase().replace(/[.,;:]+$/, "")
  // A trailing lab-room number ("AI Lab 4") is part of the subject's name,
  // so "AI Lab" and "AI Lab 4" compare equal - but "AI" (theory) stays
  // distinct, and numeric course codes like "Math 101" are never touched.
  return /lab\s*\d+$/.test(base) ? base.replace(/\s*\d+$/, "") : base
}

// Case-insensitive, trimmed subject comparison (same copy-artifact tolerance
// as the status column) that treats a trailing lab-room number as part of
// the subject's identity - a CSV row saying "AI Lab" attaches to the
// "AI Lab 4" master class rather than becoming a duplicate one-off class.
const subjectsMatch = (a: string, b: string) => normalizeSubject(a) === normalizeSubject(b)

// Builds the subject list for stats: one entry per normalized subject, so
// names that differ only by case / trailing punctuation / a lab-room number
// ("AI Lab" and "AI Lab 4") collapse onto a single card. Each entry is
// labeled with the master timetable's spelling when one exists (falling back
// to the extra class's spelling), so stats never show the same subject twice.
export const subjectLabelsByKey = (
  lectures: Lecture[],
  extras: ExtraLecture[]
): Map<string, string> => {
  const labels = new Map<string, string>()
  for (const l of lectures) {
    const key = normalizeSubject(l.subject)
    if (!labels.has(key)) labels.set(key, l.subject)
  }
  for (const e of extras) {
    const key = normalizeSubject(e.subject)
    if (!labels.has(key)) labels.set(key, e.subject)
  }
  return labels
}

// Parses pasted/edited CSV text into per-date "day plans". Each date in the
// file is treated as a complete snapshot of that day - the CSV is the source
// of truth for which classes happened and how they went. Rows are resolved
// against `lectures` (the CURRENT master timetable) by SUBJECT first: a row
// attaches to the master class with the same subject that day (keeping its
// time, or moving it for that day if the file lists a different time), and a
// row whose subject matches no master class becomes a one-off class for that
// exact date. The file's lectureId column is never trusted - ids are
// resolved from the timetable or generated deterministically. Invalid or
// unresolvable rows are skipped rather than failing the whole import.
export const parseAttendanceCsv = (
  csvText: string,
  lectures: Lecture[] = []
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

  const plansByDate = new Map<string, CsvDayPlan>()
  const planFor = (date: string): CsvDayPlan => {
    let plan = plansByDate.get(date)
    if (!plan) {
      plan = { date, attendance: [], coveredLectureIds: [], timeOverrides: [], extraLectures: [] }
      plansByDate.set(date, plan)
    }
    return plan
  }

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
    // Copying CSV out of a chat message, spreadsheet, or email often drags a
    // sentence period (or similar punctuation) onto the very last field of
    // the file. Strip trailing sentence punctuation before validating - the
    // result can never collide with another status ("present." can only be
    // "present"). The raw value is kept for error messages.
    const status = statusRaw.replace(/[.,;:]+$/, "")
    if (!VALID_STATUSES.includes(status as AttendanceStatus)) {
      skippedReasons.push(`Row ${rowNum}: invalid status "${statusRaw}" (expected present/absent/cancelled)`)
      continue
    }

    const plan = planFor(date)
    const weekday = getDayOfWeek(date)
    const startMinutes = toMinutes(startTime)
    const dayLectures = lectures.filter(l => l.day === weekday)

    const covered = (lectureId: string) => {
      if (!plan.coveredLectureIds.includes(lectureId)) plan.coveredLectureIds.push(lectureId)
    }
    const mark = (lectureId: string) => {
      const entry = { id: `${lectureId}-${date}`, date, lectureId, status: status as AttendanceStatus }
      entries.push(entry)
      plan.attendance.push(entry)
    }

    if (subject) {
      const bySubject = dayLectures.filter(l => subjectsMatch(l.subject, subject))
      if (bySubject.length === 0) {
        // No master class with this subject that day - the CSV defines a
        // one-off class for this exact date. Deterministic id so re-imports
        // and Today-screen edits of the same class stay linked.
        const extraId = `${slugifyId(subject)}-${date}-${timeTokenForId(startTime)}`
        if (!plan.extraLectures.some(e => e.id === extraId)) {
          plan.extraLectures.push({ id: extraId, date, subject, startTime })
        }
        mark(extraId)
        continue
      }
      if (bySubject.length > 1) {
        // More than one class with that subject that day - only a time that
        // pins one of them down is unambiguous.
        const bySubjectAndTime = bySubject.filter(l => toMinutes(l.startTime) === startMinutes)
        if (bySubjectAndTime.length !== 1) {
          skippedReasons.push(`Row ${rowNum}: ${bySubject.length} classes named "${subject}" that day (${date}) - add a time that matches one of them to disambiguate`)
          continue
        }
        covered(bySubjectAndTime[0].id)
        mark(bySubjectAndTime[0].id)
        continue
      }
      const lecture = bySubject[0]
      covered(lecture.id)
      if (toMinutes(lecture.startTime) !== startMinutes) {
        // Listed at a different time than the timetable - a time-move for
        // this day only, recorded as a day override.
        const alreadyMoved = plan.timeOverrides.some(o => o.lectureId === lecture.id)
        if (!alreadyMoved) {
          plan.timeOverrides.push({
            id: `${lecture.id}-${date}`,
            date,
            lectureId: lecture.id,
            subject: lecture.subject,
            startTime
          })
        }
      }
      mark(lecture.id)
      continue
    }

    // No subject column/value - fall back to time-only matching.
    const byTime = dayLectures.filter(l => toMinutes(l.startTime) === startMinutes)
    if (byTime.length === 1) {
      covered(byTime[0].id)
      mark(byTime[0].id)
      continue
    }
    if (byTime.length > 1) {
      skippedReasons.push(`Row ${rowNum}: no subject given and ${byTime.length} classes at ${startTime} that day (${date}) - add the subject column to disambiguate`)
      continue
    }
    skippedReasons.push(`Row ${rowNum}: no class at ${startTime} on ${date} in your timetable, and no subject was given to create one`)
  }

  if (entries.length === 0) {
    return {
      ok: false,
      error: skippedReasons.length > 0
        ? `No valid rows found.\n${skippedReasons.slice(0, 5).join("\n")}`
        : "No data rows found."
    }
  }

  const dayPlans = Array.from(plansByDate.values())
  return { ok: true, dayPlans, entries, skippedCount: skippedReasons.length, skippedReasons }
}
