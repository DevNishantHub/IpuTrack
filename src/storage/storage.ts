// src/storage/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Attendance, Lecture, Break } from "../types"
import { seedLectures } from "../data/seedLectures"
import { seedBreaks } from "../data/seedBreaks"

const LECTURES_KEY = "lectures"
const ATTENDANCE_KEY = "attendance"
const BREAKS_KEY = "breaks"

export const getLectures = async (): Promise<Lecture[]> => {
  const raw = await AsyncStorage.getItem(LECTURES_KEY)
  if (raw) return JSON.parse(raw)

  // First run: no timetable saved yet, so pre-fill with the default schedule.
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(seedLectures))
  return seedLectures
}

export const saveLectures = async (lectures: Lecture[]): Promise<void> => {
  await AsyncStorage.setItem(LECTURES_KEY, JSON.stringify(lectures))
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
  await AsyncStorage.removeMany([LECTURES_KEY, ATTENDANCE_KEY, BREAKS_KEY])
}
