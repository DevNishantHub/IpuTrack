// src/utils/attendance.ts
import { Attendance } from "../types"

export const calculateStats = (attendance: Attendance[]) => {
  let present = 0
  let absent = 0
  let cancelled = 0

  attendance.forEach((a: Attendance) => {
    if (a.status === "present") present++
    else if (a.status === "absent") absent++
    else cancelled++
  })

  const valid = present + absent
  const percentage = valid === 0 ? 0 : (present / valid) * 100

  return { present, absent, cancelled, percentage }
}
