// src/data/seedLectures.ts
import { Lecture } from "../types"

// day: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
// BREAK slots are intentionally skipped (not real lectures).
export const seedLectures: Lecture[] = [
  // 8:30 - 9:30
  { id: "seed-1", subject: "AI", day: 1, startTime: "8:30" },
  { id: "seed-2", subject: "CN", day: 2, startTime: "8:30" },
  { id: "seed-3", subject: "AI", day: 3, startTime: "8:30" },
  { id: "seed-4", subject: "CN", day: 4, startTime: "8:30" },
  { id: "seed-5", subject: "AI Lab 4", day: 5, startTime: "8:30" },

  // 9:30 - 10:30
  { id: "seed-6", subject: "CN", day: 1, startTime: "9:30" },
  { id: "seed-7", subject: "NLP Lab 4", day: 2, startTime: "9:30" },
  { id: "seed-8", subject: "NLP", day: 3, startTime: "9:30" },
  { id: "seed-9", subject: "CN", day: 4, startTime: "9:30" },
  { id: "seed-10", subject: "CN", day: 5, startTime: "9:30" },

  // 10:30 - 11:30 (Wed is BREAK, skipped)
  { id: "seed-11", subject: "AI Lab 4", day: 1, startTime: "10:30" },
  { id: "seed-12", subject: "CN Lab 4", day: 2, startTime: "10:30" },
  { id: "seed-13", subject: "AI Lab 4", day: 4, startTime: "10:30" },
  { id: "seed-14", subject: "NLP", day: 5, startTime: "10:30" },

  // 11:30 - 12:30 (Mon, Tue, Thu, Fri are BREAK, only Wed has IMED)
  { id: "seed-15", subject: "IMED", day: 3, startTime: "11:30" },

  // 12:30 - 1:30
  { id: "seed-16", subject: "NLP", day: 1, startTime: "12:30" },
  { id: "seed-17", subject: "AI", day: 2, startTime: "12:30" },
  { id: "seed-18", subject: "NLP Lab 4", day: 3, startTime: "12:30" },
  { id: "seed-19", subject: "IMED", day: 4, startTime: "12:30" },
  { id: "seed-20", subject: "NLP Lab 4", day: 5, startTime: "12:30" },

  // 1:30 - 2:30 (Wed empty)
  { id: "seed-21", subject: "NLP Lab 4", day: 1, startTime: "13:30" },
  { id: "seed-22", subject: "AI Lab 4", day: 2, startTime: "13:30" },
  { id: "seed-23", subject: "CN Lab 4", day: 4, startTime: "13:30" },
  { id: "seed-24", subject: "IMED", day: 5, startTime: "13:30" },

  // 2:30 - 3:30 (only Thu)
  { id: "seed-25", subject: "AI", day: 4, startTime: "14:30", note: "512" }
]
