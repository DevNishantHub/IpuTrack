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

export type ArchivedSemester = {
  id: string
  startDate: string
  endDate: string
  attendance: Attendance[]
  lectures: Lecture[]
}

// A calendar date with no classes at all (college holiday, exam break,
// etc). Deliberately NOT a DayOverride: it never writes/touches Attendance
// or DayOverride rows, it just tells the UI "don't show markable lectures
// for this date." Existing attendance for that date (if any) is untouched.
export type Holiday = {
  date: string // YYYY-MM-DD
  label?: string
}
