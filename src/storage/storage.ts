// src/storage/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Attendance, Lecture, Break, DayOverride } from "../types"
import { seedLectures } from "../data/seedLectures"
import { seedBreaks } from "../data/seedBreaks"

const LECTURES_KEY = "lectures"
const ATTENDANCE_KEY = "attendance"
const BREAKS_KEY = "breaks"
const TIMETABLE_IMPORTED_KEY = "timetableImported"
const OVERRIDES_KEY = "dayOverrides"
const ATTENDANCE_THRESHOLD_KEY = "attendanceThreshold"
const LOW_ATTENDANCE_NOTIFIED_KEY = "lowAttendanceNotified"

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

export const getLectures = async (): Promise<Lecture[]> => {
  const raw = await AsyncStorage.getItem(LECTURES_KEY)
  if (raw) return safeJsonParse<Lecture[]>(raw, seedLectures)

  // First run: no timetable saved yet, so pre-fill with the default schedule.
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(seedLectures))
  return seedLectures
}

// Internal use only (e.g. seeding, or the guarded import flow). Screens should
// not call this directly for the master timetable once it has been imported -
// use setMasterTimetable instead, which also locks it in.
export const saveLectures = async (lectures: Lecture[]): Promise<void> => {
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(lectures))
}

// Whether the user has ever imported their own timetable via the AI-JSON
// flow. Until this is true, the seed/default schedule is just a placeholder.
export const isTimetableImported = async (): Promise<boolean> => {
  const raw = await AsyncStorage.getItem(TIMETABLE_IMPORTED_KEY)
  return raw === "true"
}

// Replaces the ENTIRE master timetable and marks it as imported/locked.
// This is the only intended way to change the master timetable after setup -
// there is no in-app per-lecture editing of the master table by design.
export const setMasterTimetable = async (lectures: Lecture[]): Promise<void> => {
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(lectures))
  await AsyncStorage.setItem(TIMETABLE_IMPORTED_KEY, "true")
}

// --- Day overrides: one-off changes to a single lecture on a single date ---
// These never touch the master timetable and are meant to auto-expire
// (anything not matching today's date is dropped on read).

export const getOverridesForDate = async (date: string): Promise<DayOverride[]> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
  return all.filter(o => o.date === date)
}

export const saveOverride = async (entry: DayOverride): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
  const updated = all.filter(
    o => !(o.lectureId === entry.lectureId && o.date === entry.date)
  )
  updated.push(entry)
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
}

export const clearOverride = async (lectureId: string, date: string): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
  const updated = all.filter(o => !(o.lectureId === lectureId && o.date === date))
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
}

// Drops any override rows whose date has passed, so overrides never linger
// beyond the single day they were meant for. Safe to call on every app load.
export const pruneExpiredOverrides = async (todayDate: string): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? safeJsonParse<DayOverride[]>(raw, []) : []
  const kept = all.filter(o => o.date >= todayDate)
  if (kept.length !== all.length) {
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(kept))
  }
}

export const getBreaks = async (): Promise<Break[]> => {
  const raw = await AsyncStorage.getItem(BREAKS_KEY)
  if (raw) return safeJsonParse<Break[]>(raw, seedBreaks)

  await AsyncStorage.setItem(BREAKS_KEY, JSON.stringify(seedBreaks))
  return seedBreaks
}

export const saveBreaks = async (breaks: Break[]): Promise<void> => {
  await AsyncStorage.setItem(BREAKS_KEY, JSON.stringify(breaks))
}

export const getAttendance = async (): Promise<Attendance[]> => {
  const raw = await AsyncStorage.getItem(ATTENDANCE_KEY)
  return raw ? safeJsonParse<Attendance[]>(raw, []) : []
}

export const saveAttendance = async (entry: Attendance): Promise<void> => {
  const data = await getAttendance()
  const updated = data.filter(
    e => !(e.lectureId === entry.lectureId && e.date === entry.date)
  )
  updated.push(entry)
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(updated))
}

// Merges many attendance entries in one read+write (used by CSV import),
// instead of calling saveAttendance() per row which would do N sequential
// AsyncStorage read-modify-writes. Entries with the same lectureId+date as
// an incoming one are replaced, same "last write wins" semantics as
// saveAttendance.
export const saveAttendanceBulk = async (entries: Attendance[]): Promise<void> => {
  if (entries.length === 0) return
  const data = await getAttendance()
  const incomingKey = (e: Attendance) => `${e.lectureId}|${e.date}`
  const incomingKeys = new Set(entries.map(incomingKey))
  const kept = data.filter(e => !incomingKeys.has(incomingKey(e)))
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify([...kept, ...entries]))
}

export const clearAllData = async (): Promise<void> => {
  await AsyncStorage.multiRemove([
    LECTURES_KEY,
    ATTENDANCE_KEY,
    BREAKS_KEY,
    TIMETABLE_IMPORTED_KEY,
    OVERRIDES_KEY,
    ATTENDANCE_THRESHOLD_KEY,
    LOW_ATTENDANCE_NOTIFIED_KEY
  ])
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
  const raw = await AsyncStorage.getItem(LOW_ATTENDANCE_NOTIFIED_KEY)
  const map: Record<string, boolean> = raw ? safeJsonParse<Record<string, boolean>>(raw, {}) : {}
  if (notified) {
    map[subject] = true
  } else {
    delete map[subject]
  }
  await AsyncStorage.setItem(LOW_ATTENDANCE_NOTIFIED_KEY, JSON.stringify(map))
}
