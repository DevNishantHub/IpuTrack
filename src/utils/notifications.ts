// src/utils/notifications.ts
import * as Notifications from "expo-notifications"
import { Alert } from "react-native"
import { Lecture } from "../types"

const CHANNEL_ID = "low-attendance"
const REMINDER_CHANNEL_ID = "class-reminders"
// Every scheduled class-reminder notification uses this identifier prefix
// so they can all be found and cancelled as a group (e.g. when reminders
// are turned off, the timetable changes, or all data is reset) without
// touching the unrelated low-attendance notification.
const REMINDER_ID_PREFIX = "class-reminder-"

// Notification text (subject, note) can come from AI-imported timetable
// JSON, which isn't a trusted source - strip control/newline chars and cap
// length before it lands in any notification body. Single implementation so
// every call site enforces the same rule instead of each hand-rolling its
// own copy that can silently drift from the others.
const sanitizeForNotification = (value: string): string =>
  value.replace(/[\r\n\t]/g, " ").trim().slice(0, 50)

export const ensureNotificationPermission = async (): Promise<boolean> => {
  try {
    const { status } = await Notifications.getPermissionsAsync()
    if (status === "granted") return true

    const { status: newStatus } = await Notifications.requestPermissionsAsync()
    return newStatus === "granted"
  } catch (err) {
    // Missing native module, Android manifest misconfiguration, etc. Treat
    // as "no permission" rather than letting the rejection crash the app.
    console.warn("Notification permission check failed:", err)
    return false
  }
}

export const notifyLowAttendance = async (
  subject: string,
  percentage: number,
  threshold: number
): Promise<void> => {
  const safeSubject = sanitizeForNotification(subject)
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Low Attendance",
      importance: Notifications.AndroidImportance.HIGH,
    })

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Attendance is low",
        body: `${safeSubject} is at ${percentage}%, below your ${threshold}% target.`,
      },
      trigger: null,
    })
  } catch (err) {
    console.warn("Failed to schedule low-attendance notification:", err)
  }
}

// Cancels every previously-scheduled class-reminder notification (and only
// those - low-attendance notifications use a separate, unprefixed
// identifier and are untouched). Safe to call even if none are scheduled.
export const cancelAllClassReminders = async (): Promise<void> => {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync()
    const ours = scheduled.filter(n => n.identifier.startsWith(REMINDER_ID_PREFIX))
    await Promise.all(
      ours.map(n => Notifications.cancelScheduledNotificationAsync(n.identifier))
    )
  } catch (err) {
    console.warn("Failed to cancel existing class reminders:", err)
  }
}

// Schedules one recurring weekly reminder per lecture, `minutesBefore`
// minutes ahead of its startTime. Always cancels every existing reminder
// first, so this is safe to call repeatedly (toggling the setting,
// changing minutesBefore, or after the timetable is replaced) without ever
// leaving stale/duplicate reminders behind.
//
// Limitation (by design, not a bug): reminders follow the PERMANENT weekly
// timetable only. A one-off "edit for today" (time change or cancellation
// via a DayOverride) does not shift or skip that day's reminder, since the
// underlying trigger is a recurring weekday+time, not a specific date.
export const scheduleClassReminders = async (
  lectures: Lecture[],
  minutesBefore: number
): Promise<void> => {
  await cancelAllClassReminders()

  if (lectures.length === 0) return

  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name: "Class Reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  } catch (err) {
    console.warn("Failed to set up class-reminder notification channel:", err)
  }

  // Fire all schedule calls concurrently instead of one at a time. Each
  // scheduleNotificationAsync is an independent native-bridge round trip;
  // awaiting them sequentially in a for-loop made this take several seconds
  // (and feel "stuck") for a full timetable. They don't depend on each
  // other, so there's nothing gained by serializing them.
  await Promise.all(
    lectures.map(async lecture => {
      const [hours, minutes] = lecture.startTime.split(":").map(Number)
      if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        // Malformed startTime on one lecture shouldn't stop the rest from
        // being scheduled.
        console.warn(`Skipping reminder for "${lecture.subject}": invalid startTime "${lecture.startTime}"`)
        return
      }

      // lecture.day must be an integer 0-6 (0=Sunday..6=Saturday) to produce
      // a valid weekday for expo-notifications' WEEKLY trigger (1=Sunday..7=Saturday).
      if (!Number.isInteger(lecture.day) || lecture.day < 0 || lecture.day > 6) {
        console.warn(`Skipping reminder for "${lecture.subject}": invalid day "${lecture.day}"`)
        return
      }

      // expo-notifications' WEEKLY trigger uses 1=Sunday..7=Saturday;
      // Lecture.day uses JS's 0=Sunday..6=Saturday (see dateHelpers).
      let weekday = lecture.day + 1
      let totalMinutes = hours * 60 + minutes - minutesBefore

      // If "minutesBefore" pushes the reminder before midnight, it belongs
      // on the previous weekday instead - roll both fields back together so
      // e.g. a 00:05 Monday class with a 10-minute reminder correctly fires
      // at 23:55 on Sunday, not at a nonsensical negative time on Monday.
      while (totalMinutes < 0) {
        totalMinutes += 24 * 60
        weekday = weekday === 1 ? 7 : weekday - 1
      }

      const reminderHour = Math.floor(totalMinutes / 60) % 24
      const reminderMinute = totalMinutes % 60

      const safeSubject = sanitizeForNotification(lecture.subject)
      const safeNote = lecture.note ? sanitizeForNotification(lecture.note) : undefined

      try {
        await Notifications.scheduleNotificationAsync({
          identifier: `${REMINDER_ID_PREFIX}${lecture.id}`,
          content: {
            title: "Upcoming class",
            body: `${safeSubject} at ${lecture.startTime}${safeNote ? ` · ${safeNote}` : ""}`,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday,
            hour: reminderHour,
            minute: reminderMinute,
          },
        })
      } catch (err) {
        // One lecture failing to schedule (e.g. a platform quirk, or the
        // OS-level pending-notification cap being hit) shouldn't abort the
        // rest.
        console.warn(`Failed to schedule reminder for "${lecture.subject}":`, err)
      }
    })
  )
}
