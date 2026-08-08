// src/types.ts
export type Lecture = {
  id: string
  subject: string
  day: number
  startTime: string
  endTime: string
}

export type Break = {
  day: number
  startTime: string
}

export type AttendanceStatus = "present" | "absent" | "cancelled"

export type Attendance = {
  id: string
  lectureId: string
  date: string
  status: AttendanceStatus
}
