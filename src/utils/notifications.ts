// src/utils/notifications.ts
import * as Notifications from "expo-notifications"
import { Alert } from "react-native"

const CHANNEL_ID = "low-attendance"

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
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Low Attendance",
      importance: Notifications.AndroidImportance.HIGH,
    })

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Attendance is low",
        body: `${subject} is at ${percentage}%, below your ${threshold}% target.`,
      },
      trigger: null,
    })
  } catch (err) {
    console.warn("Failed to schedule low-attendance notification:", err)
  }
}