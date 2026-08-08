// src/utils/timetableImport.ts
import { Lecture } from "../types"

// The prompt the user copies and pastes into ChatGPT/Gemini/etc, alongside a
// photo of their printed/handwritten timetable. Keep this in sync with
// validateImportedTimetable below - the schema described here must match
// what the validator actually accepts.
export const TIMETABLE_IMPORT_PROMPT = `I'm going to attach a photo of my college class timetable. Read it carefully and reply with ONLY a JSON array, no explanation, no markdown code fences, nothing before or after it.

Each item in the array must look exactly like this:
{"subject": "AI", "day": 1, "startTime": "8:30", "note": "512"}

Field rules:
- "subject": short subject name as written on the timetable (e.g. "AI", "CN", "NLP", "AI Lab").
- "day": a number for the day of the week - 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday.
- "startTime": 24-hour time as "H:MM" or "HH:MM", e.g. "8:30" or "14:30".
- "note": OPTIONAL. Only include this if there's extra info next to that class, like a room number (e.g. "512"). Leave it out entirely if there's nothing extra.
- Do not include breaks, lunch, or free periods as items.
- Do not merge multiple classes into one item.

Reply with ONLY the JSON array. Nothing else.`

export type ImportValidationResult =
  | { ok: true; lectures: Lecture[] }
  | { ok: false; error: string }

const DAY_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/

// Validates and normalizes JSON pasted back from the external AI into real
// Lecture objects. Deliberately strict: if anything looks off, we return a
// clear error so the user can go paste the same problem back into the AI
// and fix it there, rather than us guessing and silently corrupting data.
export const validateImportedTimetable = (rawText: string): ImportValidationResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText.trim())
  } catch {
    return {
      ok: false,
      error:
        "That doesn't look like valid JSON. Copy the exact reply from the AI (nothing added or removed) and paste it again."
    }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, error: "Expected a JSON array of lectures, but got something else." }
  }
  if (parsed.length === 0) {
    return { ok: false, error: "That JSON array is empty - no lectures found." }
  }

  const lectures: Lecture[] = []
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Record<string, unknown>
    const pos = `Item ${i + 1}`

    if (typeof item !== "object" || item === null) {
      return { ok: false, error: `${pos} isn't a valid object.` }
    }
    if (typeof item.subject !== "string" || !item.subject.trim()) {
      return { ok: false, error: `${pos} is missing a valid "subject".` }
    }
    if (typeof item.day !== "number" || item.day < 0 || item.day > 6 || !Number.isInteger(item.day)) {
      return { ok: false, error: `${pos} ("${item.subject}") has an invalid "day" - must be a whole number 0-6.` }
    }
    if (typeof item.startTime !== "string" || !DAY_TIME_RE.test(item.startTime)) {
      return {
        ok: false,
        error: `${pos} ("${item.subject}") has an invalid "startTime" - must look like "8:30" or "14:30".`
      }
    }
    if (item.note !== undefined && typeof item.note !== "string") {
      return { ok: false, error: `${pos} ("${item.subject}") has a "note" that isn't text.` }
    }

    lectures.push({
      id: `import-${Date.now()}-${i}`,
      subject: item.subject.trim(),
      day: item.day,
      startTime: item.startTime,
      note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : undefined
    })
  }

  return { ok: true, lectures }
}
