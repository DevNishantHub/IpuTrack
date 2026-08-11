// src/utils/attendance.ts
import { Attendance, Lecture } from "../types"
import { getAttendanceThreshold, wasLowAttendanceNotified, setLowAttendanceNotified, getEffectiveThreshold } from "../storage/storage"
import { notifyLowAttendance } from "./notifications"
import { getSemesterStartDate } from "../storage/storage"

export const calculateStats = (attendance: Attendance[]) => {
  const present = attendance.filter(a => a.status === "present").length
  const absent = attendance.filter(a => a.status === "absent").length
  const cancelled = attendance.filter(a => a.status === "cancelled").length

  const valid = present + absent
  const percentage = valid === 0 ? 0 : (present / valid) * 100

  return { present, absent, cancelled, percentage }
}

// `extraLectureIds` are one-off classes for a subject (added from the Today
// tab or created by CSV import). Their attendance counts toward the subject's
// percentage and skip/attend math, since the user genuinely attended them -
// but only master-timetable classes count as "classes remaining": a one-off
// exists on a single past/future date and can't be skipped ahead of time.
export const calculateBunkInfo = (
  attendance: Attendance[],
  lectures: Lecture[],
  subject: string,
  threshold: number,
  extraLectureIds: string[] = []
): { canSkip: number; mustAttend: number; currentPct: number } => {
  const masterLectureIds = lectures
    .filter(l => l.subject === subject)
    .map(l => l.id)
  const lectureIds = [...masterLectureIds, ...extraLectureIds]
  const subjectAttendance = attendance.filter(a => lectureIds.includes(a.lectureId))

  const { present, absent, percentage: currentPct } = calculateStats(subjectAttendance)
  const totalClasses = masterLectureIds.length

  if (totalClasses === 0) {
    return { canSkip: 0, mustAttend: 0, currentPct: 0 }
  }

  // The skip/attend formulas below assume their denominator base is exactly
  // present + absent - which now includes one-off extras - so the attended
  // count must match that base, not a master-only count.
  const attendedClasses = present + absent
  // Remaining classes are master-timetable only: a one-off extra exists on a
  // single date and can't be skipped ahead of time, so its attendance must
  // not inflate the future-class count.
  const masterAttended = attendance.filter(
    a => masterLectureIds.includes(a.lectureId) && (a.status === "present" || a.status === "absent")
  ).length
  const futureClasses = Math.max(0, totalClasses - masterAttended)

  // Formula: (present) / (present + absent + futureSkipped) >= threshold/100
  // present >= (threshold/100) * (present + absent + futureSkipped)
  // present * 100 >= threshold * (present + absent + futureSkipped)
  // present * 100 >= threshold * (attendedClasses + futureSkipped)
  // futureSkipped <= (present * 100 / threshold) - attendedClasses
  const maxAbsentAllowed = Math.floor((present * 100) / threshold - attendedClasses)
  const canSkip = Math.max(0, Math.min(maxAbsentAllowed, futureClasses))

  // If already below threshold, calculate how many must attend
  let mustAttend = 0
  if (currentPct < threshold && futureClasses > 0) {
    // Need: (present + x) / (attendedClasses + x) >= threshold/100
    // (present + x) * 100 >= threshold * (attendedClasses + x)
    // present*100 + x*100 >= threshold*attendedClasses + threshold*x
    // x*(100 - threshold) >= threshold*attendedClasses - present*100
    // x >= (threshold*attendedClasses - present*100) / (100 - threshold)
    mustAttend = Math.ceil((threshold * attendedClasses - present * 100) / (100 - threshold))
    mustAttend = Math.max(0, Math.min(mustAttend, futureClasses))
  }

  return { canSkip, mustAttend, currentPct }
}

export const getAttendanceTrend = (
  attendance: Attendance[],
  lectures: Lecture[],
  subject: string,
  semesterStartDate: string,
  extraLectureIds: string[] = []
): { date: string; percentage: number }[] => {
  const lectureIds = [
    ...lectures.filter(l => l.subject === subject).map(l => l.id),
    ...extraLectureIds
  ]
  const subjectAttendance = attendance.filter(a => lectureIds.includes(a.lectureId))

  // Filter by semester start date
  const filtered = subjectAttendance.filter(a => a.date >= semesterStartDate)

  // Group by date and calculate cumulative percentage
  const byDate = new Map<string, Attendance[]>()
  for (const a of filtered) {
    if (!byDate.has(a.date)) byDate.set(a.date, [])
    byDate.get(a.date)!.push(a)
  }

  const sortedDates = Array.from(byDate.keys()).sort()
  let cumulativePresent = 0
  let cumulativeAbsent = 0
  const trend: { date: string; percentage: number }[] = []

  for (const date of sortedDates) {
    const dayAttendance = byDate.get(date)!
    for (const a of dayAttendance) {
      if (a.status === "present") cumulativePresent++
      else if (a.status === "absent") cumulativeAbsent++
    }
    const total = cumulativePresent + cumulativeAbsent
    const pct = total === 0 ? 0 : (cumulativePresent / total) * 100
    trend.push({ date, percentage: pct })
  }

  return trend
}

export const checkLowAttendanceAndNotify = async (
  lectureId: string,
  allLectures: Lecture[],
  allAttendance: Attendance[]
): Promise<void> => {
  const lecture = allLectures.find(l => l.id === lectureId)
  if (!lecture) {
    // Attendance exists for a lectureId that isn't in the current master
    // timetable (e.g. it was removed by a later import after the record
    // was created). There's no subject to resolve a threshold against, so
    // the check genuinely can't run for this call - but logging beats a
    // silent no-op, since this previously gave no signal that a
    // low-attendance check was skipped rather than simply passing.
    console.warn(`checkLowAttendanceAndNotify: no lecture found for lectureId "${lectureId}", skipping check`)
    return
  }

  const subject = lecture.subject
  const lectureIds = allLectures
    .filter(l => l.subject === subject)
    .map(l => l.id)
  const subjectAttendance = allAttendance.filter(a => lectureIds.includes(a.lectureId))

  const stats = calculateStats(subjectAttendance)
  const valid = stats.present + stats.absent
  if (valid === 0) return

  const threshold = await getEffectiveThreshold(subject)
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
