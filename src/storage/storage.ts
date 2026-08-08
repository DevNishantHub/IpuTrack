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

export const getLectures = async (): Promise<Lecture[]> => {
  const raw = await AsyncStorage.getItem(LECTURES_KEY)
  if (raw) return JSON.parse(raw)

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
  const all: DayOverride[] = raw ? JSON.parse(raw) : []
  return all.filter(o => o.date === date)
}

export const saveOverride = async (entry: DayOverride): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? JSON.parse(raw) : []
  const updated = all.filter(
    o => !(o.lectureId === entry.lectureId && o.date === entry.date)
  )
  updated.push(entry)
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
}

export const clearOverride = async (lectureId: string, date: string): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? JSON.parse(raw) : []
  const updated = all.filter(o => !(o.lectureId === lectureId && o.date === date))
  await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(updated))
}

// Drops any override rows whose date has passed, so overrides never linger
// beyond the single day they were meant for. Safe to call on every app load.
export const pruneExpiredOverrides = async (todayDate: string): Promise<void> => {
  const raw = await AsyncStorage.getItem(OVERRIDES_KEY)
  const all: DayOverride[] = raw ? JSON.parse(raw) : []
  const kept = all.filter(o => o.date >= todayDate)
  if (kept.length !== all.length) {
    await AsyncStorage.setItem(OVERRIDES_KEY, JSON.stringify(kept))
  }
}

export const getBreaks = async (): Promise<Break[]> => {
  const raw = await AsyncStorage.getItem(BREAKS_KEY)
  if (raw) return JSON.parse(raw)

  await AsyncStorage.setItem(BREAKS_KEY, JSON.stringify(seedBreaks))
  return seedBreaks
}

export const saveBreaks = async (breaks: Break[]): Promise<void> => {
  await AsyncStorage.setItem(BREAKS_KEY, JSON.stringify(breaks))
}

export const getAttendance = async (): Promise<Attendance[]> => {
  const raw = await AsyncStorage.getItem(ATTENDANCE_KEY)
  return raw ? JSON.parse(raw) : []
}

export const saveAttendance = async (entry: Attendance): Promise<void> => {
  const data = await getAttendance()
  const updated = data.filter(
    e => !(e.lectureId === entry.lectureId && e.date === entry.date)
  )
  updated.push(entry)
  await AsyncStorage.setItem(ATTENDANCE_KEY, JSON.stringify(updated))
}

export const clearAllData = async (): Promise<void> => {
  await AsyncStorage.multiRemove([
    LECTURES_KEY,
    ATTENDANCE_KEY,
    BREAKS_KEY,
    TIMETABLE_IMPORTED_KEY,
    OVERRIDES_KEY
  ])
}
