// src/types.ts
export type Lecture = {
  id: string
  subject: string
  day: number
  startTime: string
  note?: string // freeform note, e.g. room number. Not a separate subject.
}

export type Break = {
  day: number
  startTime: string
}

export type AttendanceStatus = "present" | "absent" | "cancelled"

// A one-off change to a single lecture, valid only on `date`.
// The master timetable (Lecture) is never mutated by this.
export type DayOverride = {
  id: string
  date: string // YYYY-MM-DD, the single day this applies to
  lectureId: string // which master lecture this overrides
  subject?: string
  startTime?: string
  note?: string
  cancelled?: boolean
}

export type Attendance = {
  id: string
  lectureId: string
  date: string
  status: AttendanceStatus
}
