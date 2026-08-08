// src/utils/attendance.ts
import { Attendance, Lecture } from "../types"
import { getAttendanceThreshold, wasLowAttendanceNotified, setLowAttendanceNotified } from "../storage/storage"
import { notifyLowAttendance } from "./notifications"

export const calculateStats = (attendance: Attendance[]) => {
  const present = attendance.filter(a => a.status === "present").length
  const absent = attendance.filter(a => a.status === "absent").length
  const cancelled = attendance.filter(a => a.status === "cancelled").length

  const valid = present + absent
  const percentage = valid === 0 ? 0 : (present / valid) * 100

  return { present, absent, cancelled, percentage }
}

export const checkLowAttendanceAndNotify = async (
  lectureId: string,
  allLectures: Lecture[],
  allAttendance: Attendance[]
): Promise<void> => {
  const lecture = allLectures.find(l => l.id === lectureId)
  if (!lecture) return

  const subject = lecture.subject
  const lectureIds = allLectures
    .filter(l => l.subject === subject)
    .map(l => l.id)
  const subjectAttendance = allAttendance.filter(a => lectureIds.includes(a.lectureId))

  const stats = calculateStats(subjectAttendance)
  const valid = stats.present + stats.absent
  if (valid === 0) return

  const threshold = await getAttendanceThreshold()
  // Compare against the raw (unrounded) percentage so a value like 74.95%
  // can't get rounded up to 75.0% and slip past a 75% threshold unnoticed.
  // Round only for what we display/store in the notification message.
  const displayPercentage = Math.round(stats.percentage * 10) / 10

  if (stats.percentage < threshold) {
    const alreadyNotified = await wasLowAttendanceNotified(subject)
    if (!alreadyNotified) {
      await notifyLowAttendance(subject, displayPercentage, threshold)
      await setLowAttendanceNotified(subject, true)
    }
  } else {
    const alreadyNotified = await wasLowAttendanceNotified(subject)
    if (alreadyNotified) {
      await setLowAttendanceNotified(subject, false)
    }
  }
}
