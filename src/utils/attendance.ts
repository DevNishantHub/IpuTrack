// src/utils/attendance.ts
import { Attendance } from "../types"

export const calculateStats = (attendance: Attendance[]) => {
  const present = attendance.filter(a => a.status === "present").length
  const absent = attendance.filter(a => a.status === "absent").length
  const cancelled = attendance.filter(a => a.status === "cancelled").length

  const valid = present + absent
  const percentage = valid === 0 ? 0 : (present / valid) * 100

  return { present, absent, cancelled, percentage }
}
