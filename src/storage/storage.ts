// src/storage/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Attendance, Lecture, Break, DayOverride, ArchivedSemester, Holiday, ExtraLecture } from "../types"
import { getTodayDate, isValidDateString, getDayOfWeek } from "../utils/dateHelpers"
import { slugifyId, timeTokenForId } from "../utils/timetableImport"
import { CsvDayPlan } from "../utils/csv"
import { cancelAllClassReminders } from "../utils/notifications"

const LECTURES_KEY = "lectures"
const ATTENDANCE_KEY = "attendance"
const BREAKS_KEY = "breaks"
const TIMETABLE_IMPORTED_KEY = "timetableImported"
const OVERRIDES_KEY = "dayOverrides"
const EXTRA_LECTURES_KEY = "extraLectures"
const ATTENDANCE_THRESHOLD_KEY = "attendanceThreshold"
const LOW_ATTENDANCE_NOTIFIED_KEY = "lowAttendanceNotified"
const SUBJECT_THRESHOLDS_KEY = "subjectThresholds"
const SEMESTER_START_DATE_KEY = "semesterStartDate"
const ARCHIVED_SEMESTERS_KEY = "archivedSemesters"
const HOLIDAYS_KEY = "holidays"
const REMINDER_SETTINGS_KEY = "reminderSettings"
const REMINDER_SCHEDULE_SIGNATURE_KEY = "reminderScheduleSignature"

export const DEFAULT_ATTENDANCE_THRESHOLD = 75

// Parses JSON from AsyncStorage defensively. If the stored value is
// corrupted/malformed, this logs a warning and returns the fallback instead
// of throwing, so a single bad key can't crash the whole app on load.
function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn("storage: failed to parse stored JSON, using fallback", err)
    return fallback
  }
}

// Serializes every read-modify-write storage mutation through a single
// promise chain. AsyncStorage has no transactions: an op reads, modifies,
// and writes, and two ops that interleave can each write from a stale read,
// silently clobbering the other's change (e.g. rapid taps marking two
// different classes in the same tick). Chaining the writes makes each one
// atomic relative to the others. Reads are unaffected (they always see the
// latest committed value).
let writeChain: Promise<unknown> = Promise.resolve()
const withWriteLock = <T>(op: () => Promise<T>): Promise<T> => {
  const result = writeChain.then(op, op)
  writeChain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

// Last-wins dedupe by a key function, preserving the position of the last
// occurrence of each key.
const dedupeByKey = <T>(items: T[], key: (item: T) => string): T[] =>
  Array.from(new Map(items.map(item => [key(item), item])).values())

// No placeholder/seed data: until the user imports their own timetable via
// Settings, this returns an empty list rather than pre-filling a sample
// schedule. isTimetableImported()/getLectures().length can both be used to
// tell "not set up yet" from "set up but currently empty".
export const getLectures = async (): Promise<Lecture[]> => {
  const raw = await AsyncStorage.getItem(LECTURES_KEY)
  return raw ? safeJsonParse<Lecture[]>(raw, []) : []
}

// Whether the user has ever imported their own timetable via the AI-JSON
// flow. Until this is true, getLectures()/getBreaks() return empty lists -
// there is no seeded placeholder schedule.
export const isTimetableImported = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(TIMETABLE_IMPORTED_KEY)
  return raw === "true"
}

// Replaces the ENTIRE master timetable and marks it as imported/locked.
// This is the only intended way to change the master timetable after setup -
// there is no in-app per-lecture editing of the master table by design.
//
// Attendance/overrides written under the PREVIOUS timetable reference the
// old lecture ids, so before replacing we remap those ids onto the new ones
// by matching each lecture's stable identity (subject + day + startTime).
// Together with deterministic ids (see timetableImport.ts) this means a
// re-import no longer orphans existing attendance - only slots that really
// changed (renamed/moved/removed) are left unmapped.
export const setMasterTimetable = async (lectures: Lecture[]): Promise<void> => {
  await withWriteLock(async () => {
    const [oldLectures, attendance, overrides] = await Promise.all([
      getLectures(),
      getAttendance(),
      getAllOverrides()
    ])

    // Match old lectures to new ones by their stable identity, computed
    // with the SAME normalization the import uses (slugified subject + day +
    // normalized time), so "9:00" vs "09:00" are the same slot and a
    // re-import doesn't orphan existing attendance. Slots that genuinely
    // changed (renamed/moved/removed) simply stay unmapped.
    const deterministicIdFor = (l: { subject: string; day: number; startTime: string }) =>
      `${slugifyId(l.subject)}-${l.day}-${timeTokenForId(l.startTime)}`
    const oldIdByDeterministicId = new Map(
      oldLectures.map(l => [deterministicIdFor(l), l.id])
    )
    // A duplicated slot (same subject+day+time twice in one timetable) makes
    // that identity ambiguous, so leave it unmapped rather than guessing
    // which duplicate the old attendance belongs to - they can't be told
    // apart. (An ambiguous identity in the OLD timetable is likewise only
    // ever resolved to the last duplicate's id; the rest stay unmapped.)
    const newIdentityCounts = new Map<string, number>()
    for (const l of lectures) {
      const key = deterministicIdFor(l)
      newIdentityCounts.set(key, (newIdentityCounts.get(key) ?? 0) + 1)
    }
    const idMap = new Map<string, string>()
    for (const lecture of lectures) {
      const key = deterministicIdFor(lecture)
      if (newIdentityCounts.get(key) !== 1) continue
      const oldId = oldIdByDeterministicId.get(key)
      if (oldId !== undefined && oldId !== lecture.id) idMap.set(oldId, lecture.id)
    }
    const remap = (id: string) => idMap.get(id) ?? id

    const remappedAttendance = dedupeByKey(
      attendance.map(a => ({ ...a, lectureId: remap(a.lectureId) })),
      a => `${a.lectureId}|${a.date}`
    )
    const remappedOverrides = overrides.map(o => ({ ...o, lectureId: remap(o.lectureId) }))

    await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(lectures))
    await AsyncStorage.setItem(TIMETABLE_IMPORTED_KEY, "true")
    await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(remappedAttendance))
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(remappedOverrides))
  })
}

// --- Day overrides: one-off changes to a single lecture on a single date ---
// These never touch the master timetable and are meant to auto-expire
// (anything not matching today's date is dropped on read).

export const getOverridesForDate = async (date: string): Promise<DayOverride[]> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
  return all.filter(o => o.date === date)
}

// All override rows currently in storage, regardless of date. Overrides are
// meant to be "today-only" from the Today screen's point of view, but they
// aren't pruned until pruneExpiredOverrides() next runs - so a same-day (or
// backfilled future-day) edit is live in storage before it expires. Anything
// that needs to render historical attendance rows with the subject/startTime
// the user actually saw that day (e.g. CSV export) should read this instead
// of getLectures() alone, or it'll silently show the un-edited master value.
export const getAllOverrides = async (): Promise<DayOverride[]> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  return raw ? safeJsonParse<DayOverride[]>(raw, []) : []
}

export const saveOverride = async (entry: DayOverride): Promise<void> => {
  await withWriteLock(async () => {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
    const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
    const updated = all.filter(
      o => !(o.lectureId === entry.lectureId && o.date === entry.date)
    )
    updated.push(entry)
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
  })
}

export const clearOverride = async (lectureId: string, date: string): Promise<void> => {
  await withWriteLock(async () => {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
    const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
    const updated = all.filter(o => !(o.lectureId === lectureId && o.date === date))
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
  })
}

// --- One-off extra classes ---
// A class added from the Today tab for a single date (e.g. a special lecture
// not in the master timetable). Stored separately from the master timetable
// and from DayOverrides: it exists only on `date` and never on other days.

export const getExtraLectures = async (): Promise<ExtraLecture[]> => {
  const raw = await AsyncStorage.getItem(EXTRA_LECTURES_KEY)
  return raw ? safeJsonParse<ExtraLecture[]>(raw, []) : []
}

export const getExtraLecturesForDate = async (date: string): Promise<ExtraLecture[]> => {
  const all = await getExtraLectures()
  return all.filter(e => e.date === date)
}

// Upserts by id, so editing an added class keeps its id (and therefore the
// attendance already recorded against that id).
export const saveExtraLecture = async (entry: ExtraLecture): Promise<void> => {
  await withWriteLock(async () => {
    const all = await getExtraLectures()
    const updated = all.filter(e => e.id !== entry.id)
    updated.push(entry)
    await AsyncStorage.setItem(EXTRA_LECTURES_KEY, JSON.stringify(updated))
  })
}

export const removeExtraLecture = async (id: string): Promise<void> => {
  await withWriteLock(async () => {
    const all = await getExtraLectures()
    const updated = all.filter(e => e.id !== id)
    await AsyncStorage.setItem(EXTRA_LECTURES_KEY, JSON.stringify(updated))
  })
}

// Drops any override rows whose date has passed, so overrides never linger
// beyond the single day they were meant for. Safe to call on every app load.
export const pruneExpiredOverrides = async (todayDate: string): Promise<void> => {
  await withWriteLock(async () => {
    const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
    const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
    const kept = all.filter(o => o.date >= todayDate)
    if (kept.length !== all.length) {
      await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(kept))
    }
  })
}

export const getBreaks = async (): Promise<Break[]> => {
  const raw = await AsyncStorage.getItem(BREAKS_KEY)
  return raw ? safeJsonParse<Break[]>(raw, []) : []
}

export const saveBreaks = async (breaks: Break[]): Promise<void> => {
  await AsyncStorage.setItem(BREAKS_KEY, JSON.stringify(breaks))
}

export const getAttendance = async (): Promise<Attendance[]> => {
  const raw = await AsyncStorage.getItem(ATTENDANCE_KEY)
  return raw ? safeJsonParse<Attendance[]>(raw, []) : []
}

export const saveAttendance = async (entry: Attendance): Promise<void> => {
  await withWriteLock(async () => {
    const data = await getAttendance()
    const updated = data.filter(
      e => !(e.lectureId === entry.lectureId && e.date === entry.date)
    )
    // Deterministic id (lectureId-date): the logical record for one class on
    // one day always has the same id, instead of a fresh random one per write.
    updated.push({ ...entry, id: `${entry.lectureId}-${entry.date}` })
    await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(updated))
  })
}

// Deletes every attendance record for one (lectureId, date) pair. Used when
// a class is removed for a day, so the removed class doesn't linger in
// exports/imports/stats as attendance history - it's gone entirely.
export const deleteAttendance = async (lectureId: string, date: string): Promise<void> => {
  await withWriteLock(async () => {
    const data = await getAttendance()
    const updated = data.filter(e => !(e.lectureId === lectureId && e.date === date))
    await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(updated))
  })
}

// Normalizes an incoming attendance batch for storage: every entry gets the
// deterministic lectureId-date id, and rows repeating the same lecture+date
// WITHIN one batch collapse to the last one, so a hand-merged CSV can't
// double-count a class in stats. Shared by every multi-row write path.
const normalizeAttendanceBatch = (entries: Attendance[]): Attendance[] =>
  Array.from(
    new Map(
      entries.map(e => [`${e.lectureId}|${e.date}`, { ...e, id: `${e.lectureId}-${e.date}` }])
    ).values()
  )

// Applies CSV-derived day plans atomically. Each plan is a complete snapshot
// of one date: the CSV is the source of truth for that day. Attendance for
// the planned dates is replaced with the plan's rows, all prior overrides
// and one-off classes for those dates are dropped and re-derived (covered
// master lectures keep their marks, uncovered master lectures get a
// cancelled override = removed for the day, and time-moves / CSV-defined
// one-off classes are written fresh). Everything on other dates is
// untouched. One write per key, so a rebuild can't be interrupted halfway.
export const applyCsvDayPlans = async (plans: CsvDayPlan[]): Promise<void> => {
  if (plans.length === 0) return
  await withWriteLock(async () => {
    const [lectures, attendance, overrides, extras] = await Promise.all([
      getLectures(),
      getAttendance(),
      getAllOverrides(),
      getExtraLectures()
    ])

    const planDates = new Set(plans.map(p => p.date))

    let newOverrides = overrides.filter(o => !planDates.has(o.date))
    let newExtras = extras.filter(e => !planDates.has(e.date))
    const keptAttendance = attendance.filter(a => !planDates.has(a.date))

    for (const plan of plans) {
      const weekday = getDayOfWeek(plan.date)
      const covered = new Set(plan.coveredLectureIds)
      // Every master lecture on that day that the CSV doesn't list is
      // removed for the day, so the day shows exactly the CSV's classes.
      for (const lecture of lectures) {
        if (lecture.day !== weekday || covered.has(lecture.id)) continue
        newOverrides.push({
          id: `${lecture.id}-${plan.date}`,
          date: plan.date,
          lectureId: lecture.id,
          cancelled: true
        })
      }
      newOverrides.push(...plan.timeOverrides)
      newExtras.push(...plan.extraLectures)
    }

    const writtenAttendance = [
      ...keptAttendance,
      ...normalizeAttendanceBatch(plans.flatMap(p => p.attendance))
    ]

    await Promise.all([
      AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(newOverrides)),
      AsyncStorage.setItem(EXTRA_LECTURES_KEY, JSON.stringify(newExtras)),
      AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(writtenAttendance))
    ])
  })
}

export const clearAllData = async (): Promise<void> => {
  await AsyncStorage.multiRemove([
    LECTURES_KEY,
    ATTENDANCE_KEY,
    BREAKS_KEY,
    TIMETABLE_IMPORTED_KEY,
    OVERRIDES_KEY,
    EXTRA_LECTURES_KEY,
    ATTENDANCE_THRESHOLD_KEY,
    LOW_ATTENDANCE_NOTIFIED_KEY,
    SUBJECT_THRESHOLDS_KEY,
    HOLIDAYS_KEY,
    REMINDER_SETTINGS_KEY,
    REMINDER_SCHEDULE_SIGNATURE_KEY
  ])
  // Best-effort: scheduled reminders reference lecture ids/text that are
  // about to be gone. cancelAllClassReminders already swallows its own
  // errors, so this can't make a reset fail partway through.
  await cancelAllClassReminders()
}

export const getAttendanceThreshold = async (): Promise<number> => {
  const raw = await AsyncStorage.getItem(ATTENDANCE_THRESHOLD_KEY)
  if (!raw) return DEFAULT_ATTENDANCE_THRESHOLD
  const parsed = parseInt(raw, 10)
  // Guard against a corrupted/non-numeric stored value silently disabling
  // every low-attendance check (NaN comparisons are always false).
  return Number.isNaN(parsed) ? DEFAULT_ATTENDANCE_THRESHOLD : parsed
}

export const setAttendanceThreshold = async (value: number): Promise<void> => {
  await AsyncStorage.setItem(ATTENDANCE_THRESHOLD_KEY, value.toString())
}

export const wasLowAttendanceNotified = async (subject: string): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(LOW_ATTENDANCE_NOTIFIED_KEY)
  const map: Record<string, boolean> = raw ? safeJsonParse<Record<string, boolean>>(raw, {}) : {}
  return !!map[subject]
}

export const setLowAttendanceNotified = async (subject: string, notified: boolean): Promise<void> => {
  await withWriteLock(async () => {
    const raw = await AsyncStorage.getItem(LOW_ATTENDANCE_NOTIFIED_KEY)
    const map: Record<string, boolean> = raw ? safeJsonParse<Record<string, boolean>>(raw, {}) : {}
    if (notified) {
      map[subject] = true
    } else {
      delete map[subject]
    }
    await AsyncStorage.setItem(LOW_ATTENDANCE_NOTIFIED_KEY, JSON.stringify(map))
  })
}

export const getSubjectThresholds = async (): Promise<Record<string, number>> => {
  const raw = await AsyncStorage.getItem(SUBJECT_THRESHOLDS_KEY)
  return raw ? safeJsonParse<Record<string, number>>(raw, {}) : {}
}

export const setSubjectThreshold = async (subject: string, value: number | null): Promise<void> => {
  await withWriteLock(async () => {
    const map = await getSubjectThresholds()
    if (value === null) {
      delete map[subject]
    } else {
      map[subject] = value
    }
    await AsyncStorage.setItem(SUBJECT_THRESHOLDS_KEY, JSON.stringify(map))
  })
}

// Pure resolution logic, single source of truth for how a subject's
// effective threshold is derived from already-fetched data. All threshold
// lookups (single or batch) route through this so the fallback rule only
// lives in one place.
const resolveThreshold = (
  subject: string,
  overrides: Record<string, number>,
  globalThreshold: number
): number => {
  const override = overrides[subject]
  return typeof override === "number" && !Number.isNaN(override) ? override : globalThreshold
}

// Fetches overrides + global threshold once, then resolves every subject
// in memory. Use this when resolving thresholds for multiple subjects
// (e.g. rendering a stats list) to avoid N separate storage round-trips.
export const getEffectiveThresholds = async (
  subjects: string[]
): Promise<Record<string, number>> => {
  const [overrides, globalThreshold] = await Promise.all([
    getSubjectThresholds(),
    getAttendanceThreshold()
  ])
  const result: Record<string, number> = {}
  for (const subject of subjects) {
    result[subject] = resolveThreshold(subject, overrides, globalThreshold)
  }
  return result
}

// Single-subject convenience wrapper over the same resolution logic, for
// call sites that only need one subject's threshold (e.g. a notification
// check for a single lecture).
export const getEffectiveThreshold = async (subject: string): Promise<number> => {
  const [overrides, globalThreshold] = await Promise.all([
    getSubjectThresholds(),
    getAttendanceThreshold()
  ])
  return resolveThreshold(subject, overrides, globalThreshold)
}

// --- Semester management ---
export const getSemesterStartDate = async (): Promise<string | null> => {
  const raw = await AsyncStorage.getItem(SEMESTER_START_DATE_KEY)
  return raw ?? null
}

export const setSemesterStartDate = async (date: string): Promise<void> => {
  if (!isValidDateString(date)) {
    throw new Error(`Invalid date string: "${date}". Expected YYYY-MM-DD.`)
  }
  await AsyncStorage.setItem(SEMESTER_START_DATE_KEY, date)
}

export const getArchivedSemesters = async (): Promise<ArchivedSemester[]> => {
  const raw = await AsyncStorage.getItem(ARCHIVED_SEMESTERS_KEY)
  return raw ? safeJsonParse<ArchivedSemester[]>(raw, []) : []
}

export const archiveCurrentSemester = async (): Promise<void> => {
  await withWriteLock(async () => {
    const [attendance, lectures, semesterStart] = await Promise.all([
      getAttendance(),
      getLectures(),
      getSemesterStartDate()
    ])

    const endDate = getTodayDate()
    const startDate = semesterStart ?? endDate

    if (attendance.length > 0) {
      const archived: ArchivedSemester = {
        id: `sem-${Date.now()}`,
        startDate,
        endDate,
        attendance,
        lectures
      }
      const existing = await getArchivedSemesters()
      await AsyncStorage.setItem(ARCHIVED_SEMESTERS_KEY, JSON.stringify([...existing, archived]))
    }

    // Clear current attendance, keep lectures, set new semester start
    await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify([]))
    await setSemesterStartDate(getTodayDate())
  })
}

// --- Holidays ---
// A holiday is a pure calendar-level fact ("no classes on this date"),
// stored entirely separately from Attendance and DayOverride. Marking a
// date a holiday never writes, edits, or deletes any Attendance or
// DayOverride row - it only tells the UI to stop offering that date's
// lectures for marking. If attendance was already recorded for that date
// (e.g. the user marked it before realizing/declaring it a holiday), that
// history is left completely intact and simply hidden from the "mark
// attendance" flow, not deleted.

export const getHolidays = async (): Promise<Holiday[]> => {
  const raw = await AsyncStorage.getItem(HOLIDAYS_KEY)
  return raw ? safeJsonParse<Holiday[]>(raw, []) : []
}

export const getHolidayForDate = async (date: string): Promise<Holiday | null> => {
  const holidays = await getHolidays()
  return holidays.find(h => h.date === date) ?? null
}

export const addHoliday = async (date: string, label?: string): Promise<void> => {
  if (!isValidDateString(date)) {
    throw new Error(`Invalid date string: "${date}". Expected YYYY-MM-DD.`)
  }
  await withWriteLock(async () => {
    const holidays = await getHolidays()
    // Replace any existing entry for the same date rather than duplicating.
    const updated = holidays.filter(h => h.date !== date)
    updated.push({ date, label: label?.trim() ? label.trim() : undefined })
    updated.sort((a, b) => a.date.localeCompare(b.date))
    await AsyncStorage.setItem(HOLIDAYS_KEY, JSON.stringify(updated))
  })
}

export const removeHoliday = async (date: string): Promise<void> => {
  await withWriteLock(async () => {
    const holidays = await getHolidays()
    const updated = holidays.filter(h => h.date !== date)
    await AsyncStorage.setItem(HOLIDAYS_KEY, JSON.stringify(updated))
  })
}

// --- Class reminder settings ---
export type ReminderSettings = { enabled: boolean; minutesBefore: number }

export const DEFAULT_REMINDER_MINUTES_BEFORE = 10
const MIN_REMINDER_MINUTES = 1
const MAX_REMINDER_MINUTES = 180

export const getReminderSettings = async (): Promise<ReminderSettings> => {
  const raw = await AsyncStorage.getItem(REMINDER_SETTINGS_KEY)
  const fallback: ReminderSettings = { enabled: false, minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE }
  if (!raw) return fallback

  const parsed = safeJsonParse<Partial<ReminderSettings>>(raw, {})
  const minutesBefore =
    typeof parsed.minutesBefore === "number" &&
      Number.isFinite(parsed.minutesBefore) &&
      parsed.minutesBefore >= MIN_REMINDER_MINUTES &&
      parsed.minutesBefore <= MAX_REMINDER_MINUTES
      ? parsed.minutesBefore
      : DEFAULT_REMINDER_MINUTES_BEFORE

  return { enabled: !!parsed.enabled, minutesBefore }
}

export const setReminderSettings = async (settings: ReminderSettings): Promise<void> => {
  if (
    !Number.isFinite(settings.minutesBefore) ||
    settings.minutesBefore < MIN_REMINDER_MINUTES ||
    settings.minutesBefore > MAX_REMINDER_MINUTES
  ) {
    throw new Error(`minutesBefore must be between ${MIN_REMINDER_MINUTES} and ${MAX_REMINDER_MINUTES}.`)
  }
  await AsyncStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(settings))
}

// --- Reminder schedule signature ---
// A cheap fingerprint of "what we last told the OS to schedule" (the
// lectures + minutesBefore that were passed to scheduleClassReminders).
// Cold start re-syncs reminders on every launch to guard against the OS
// clearing pending notifications or the timetable changing while the app
// was closed, but re-running the full cancel-then-reschedule loop is
// pointless work when nothing has actually changed since the last launch.
// Comparing against this signature lets the caller skip that work on the
// (common) case where nothing changed, without giving up the "always
// re-sync" safety net when something did.
export const getReminderScheduleSignature = async (): Promise<string | null> => {
  return await AsyncStorage.getItem(REMINDER_SCHEDULE_SIGNATURE_KEY)
}

export const setReminderScheduleSignature = async (signature: string): Promise<void> => {
  await AsyncStorage.setItem(REMINDER_SCHEDULE_SIGNATURE_KEY, signature)
}
