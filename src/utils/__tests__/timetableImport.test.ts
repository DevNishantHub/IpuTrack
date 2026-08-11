import { validateImportedTimetable, TIMETABLE_IMPORT_PROMPT } from "../timetableImport"

const validItem = { subject: "AI", day: 1, startTime: "8:30" }

describe("validateImportedTimetable - malformed input", () => {
  it("rejects non-JSON text", () => {
    const result = validateImportedTimetable("not json at all")
    expect(result.ok).toBe(false)
  })

  it("rejects JSON wrapped in markdown code fences (as-is, no stripping)", () => {
    const result = validateImportedTimetable("```json\n[" + JSON.stringify(validItem) + "]\n```")
    expect(result.ok).toBe(false)
  })

  it("rejects a JSON object instead of an array", () => {
    const result = validateImportedTimetable(JSON.stringify(validItem))
    expect(result.ok).toBe(false)
  })

  it("rejects an empty array", () => {
    const result = validateImportedTimetable("[]")
    expect(result.ok).toBe(false)
  })

  it("rejects a JSON array of non-objects", () => {
    const result = validateImportedTimetable(JSON.stringify(["AI", "CN"]))
    expect(result.ok).toBe(false)
  })

  it("rejects null items in the array", () => {
    const result = validateImportedTimetable(JSON.stringify([null]))
    expect(result.ok).toBe(false)
  })

  it("trims surrounding whitespace before parsing", () => {
    const result = validateImportedTimetable("   \n" + JSON.stringify([validItem]) + "\n  ")
    expect(result.ok).toBe(true)
  })
})

describe("validateImportedTimetable - subject field", () => {
  it("rejects a missing subject", () => {
    const { subject, ...rest } = validItem
    const result = validateImportedTimetable(JSON.stringify([rest]))
    expect(result.ok).toBe(false)
  })

  it("rejects an empty-string subject", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, subject: "" }]))
    expect(result.ok).toBe(false)
  })

  it("rejects a whitespace-only subject", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, subject: "   " }]))
    expect(result.ok).toBe(false)
  })

  it("rejects a non-string subject (number)", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, subject: 123 }]))
    expect(result.ok).toBe(false)
  })

  it("trims leading/trailing whitespace from a valid subject", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, subject: "  AI  " }]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures[0].subject).toBe("AI")
  })
})

describe("validateImportedTimetable - day field", () => {
  it.each([-1, 7, 1.5, NaN])("rejects out-of-range/non-integer day=%p", (day) => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, day }]))
    expect(result.ok).toBe(false)
  })

  it("rejects a string day even if numeric-looking", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, day: "1" }]))
    expect(result.ok).toBe(false)
  })

  it("accepts boundary days 0 (Sunday) and 6 (Saturday)", () => {
    const r0 = validateImportedTimetable(JSON.stringify([{ ...validItem, day: 0 }]))
    const r6 = validateImportedTimetable(JSON.stringify([{ ...validItem, day: 6 }]))
    expect(r0.ok).toBe(true)
    expect(r6.ok).toBe(true)
  })
})

describe("validateImportedTimetable - startTime field", () => {
  it.each(["25:00", "8:60", "8:3", "abc", "", "8-30", "24:00"])("rejects invalid startTime=%p", (startTime) => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, startTime }]))
    expect(result.ok).toBe(false)
  })

  it.each(["0:00", "8:30", "14:30", "23:59", "9:05"])("accepts valid startTime=%p", (startTime) => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, startTime }]))
    expect(result.ok).toBe(true)
  })

  it("rejects a numeric startTime", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, startTime: 830 }]))
    expect(result.ok).toBe(false)
  })
})

describe("validateImportedTimetable - note field", () => {
  it("is optional and omitted results in undefined note", () => {
    const result = validateImportedTimetable(JSON.stringify([validItem]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures[0].note).toBeUndefined()
  })

  it("rejects a non-string note", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, note: 512 }]))
    expect(result.ok).toBe(false)
  })

  it("trims a whitespace-only note down to undefined", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, note: "   " }]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures[0].note).toBeUndefined()
  })

  it("keeps a valid trimmed note", () => {
    const result = validateImportedTimetable(JSON.stringify([{ ...validItem, note: " 512 " }]))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures[0].note).toBe("512")
  })
})

describe("validateImportedTimetable - id generation & data integrity", () => {
  it("assigns each lecture a unique id even for identical duplicate entries (collision suffixes)", () => {
    const result = validateImportedTimetable(JSON.stringify([validItem, validItem, validItem]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      const ids = result.lectures.map(l => l.id)
      expect(new Set(ids).size).toBe(3)
      // Deterministic base id for AI / Monday / 8:30, with suffixes for dupes.
      expect(ids[0]).toBe("ai-1-8-30")
      expect(ids[1]).toBe("ai-1-8-30-2")
      expect(ids[2]).toBe("ai-1-8-30-3")
    }
  })

  it("generates deterministic classname-based ids (subject-day-time) stable across calls", () => {
    const input = JSON.stringify([{ subject: "AI Lab 4", day: 5, startTime: "8:30" }])
    const first = validateImportedTimetable(input)
    const second = validateImportedTimetable(input)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.lectures[0].id).toBe("ai-lab-4-5-8-30")
      expect(second.lectures[0].id).toBe(first.lectures[0].id)
    }
  })

  it("normalizes time variants (8:30 vs 08:30) to the same id", () => {
    const a = validateImportedTimetable(JSON.stringify([{ subject: "AI", day: 1, startTime: "8:30" }]))
    const b = validateImportedTimetable(JSON.stringify([{ subject: "AI", day: 1, startTime: "08:30" }]))
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.lectures[0].id).toBe(b.lectures[0].id)
  })

  it("preserves array order in the output", () => {
    const items = [
      { subject: "AI", day: 1, startTime: "8:30" },
      { subject: "CN", day: 2, startTime: "9:30" },
      { subject: "NLP", day: 3, startTime: "10:30" }
    ]
    const result = validateImportedTimetable(JSON.stringify(items))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures.map(l => l.subject)).toEqual(["AI", "CN", "NLP"])
  })

  it("stops at the first invalid item and reports its position (fail-fast, no partial import)", () => {
    const items = [validItem, { ...validItem, day: 99 }, validItem]
    const result = validateImportedTimetable(JSON.stringify(items))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("Item 2")
  })

  it("handles a large realistic import without truncation", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      subject: `Sub${i}`, day: i % 7, startTime: "09:00"
    }))
    const result = validateImportedTimetable(JSON.stringify(items))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.lectures).toHaveLength(50)
  })
})

describe("TIMETABLE_IMPORT_PROMPT", () => {
  it("describes a schema that the validator actually accepts (self-consistency check)", () => {
    const exampleMatch = TIMETABLE_IMPORT_PROMPT.match(/\{"subject".*?\}/)
    expect(exampleMatch).not.toBeNull()
    const result = validateImportedTimetable(`[${exampleMatch![0]}]`)
    expect(result.ok).toBe(true)
  })
})
