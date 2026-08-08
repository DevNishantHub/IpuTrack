// src/data/seedBreaks.ts
import { Break } from "../types"

// day: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// Matches the BREAK slots from the original timetable.
export const seedBreaks: Break[] = [
  { day: 1, startTime: "11:30" }, // Mon
  { day: 2, startTime: "11:30" }, // Tue
  { day: 3, startTime: "10:30" }, // Wed
  { day: 4, startTime: "11:30" }, // Thu
  { day: 5, startTime: "11:30" }  // Fri
]
