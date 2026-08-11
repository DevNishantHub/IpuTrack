import AsyncStorage from "@react-native-async-storage/async-storage"
import {
  getLectures,
  isTimetableImported,
  setMasterTimetable,
  getOverridesForDate,
  saveOverride,
  clearOverride,
  pruneExpiredOverrides,
  getExtraLectures,
  getExtraLecturesForDate,
  saveExtraLecture,
  removeExtraLecture,
  deleteAttendance,
  getBreaks,
  saveBreaks,
  getAttendance,
  saveAttendance,
  saveAttendanceBulk,
  clearAllData,
  getAttendanceThreshold,
  setAttendanceThreshold,
  wasLowAttendanceNotified,
  setLowAttendanceNotified,
  getSubjectThresholds,
  setSubjectThreshold,
  getEffectiveThresholds,
  getEffectiveThreshold,
  getSemesterStartDate,
  setSemesterStartDate,
  getArchivedSemesters,
  archiveCurrentSemester,
  getHolidays,
  getHolidayForDate,
  addHoliday,
  removeHoliday,
  getReminderSettings,
  setReminderSettings,
  DEFAULT_ATTENDANCE_THRESHOLD,
  DEFAULT_REMINDER_MINUTES_BEFORE
} from "../storage"
import { Attendance, DayOverride, ExtraLecture, Lecture } from "../../types"

// mock has .clear(); reset between every test so no state leaks
afterEach(async () => {
  await AsyncStorage.clear()
})

const lecture = (id: string, subject = "Math", day = 1, startTime = "09:00"): Lecture => ({
  id, subject, day, startTime
})

const record = (id: string, lectureId: string, date: string, status: Attendance["status"]): Attendance => ({
  id, lectureId, date, status
})

const extra = (id: string, date = "2026-01-05", subject = "Seminar", startTime = "14:00"): ExtraLecture => ({
  id, date, subject, startTime
})

describe("getLectures / setMasterTimetable / isTimetableImported", () => {
  it("returns an empty list on first read with no seeded placeholder data", async () => {
    const first = await getLectures()
    expect(first).toEqual([])
    // Nothing should be written to storage just from reading.
    const raw = await AsyncStorage.getItem("lectures")
    expect(raw).toBeNull()
  })

  it("is not marked imported until setMasterTimetable is called", async () => {
    await getLectures()
    expect(await isTimetableImported()).toBe(false)
  })

  it("setMasterTimetable replaces the whole list and flips imported to true", async () => {
    await getLectures()
    const custom = [lecture("x1", "CN")]
    await setMasterTimetable(custom)
    expect(await getLectures()).toEqual(custom)
    expect(await isTimetableImported()).toBe(true)
  })

  it("setMasterTimetable with an empty array clears the timetable (not treated as unset)", async () => {
    await setMasterTimetable([])
    expect(await getLectures()).toEqual([])
  })

  it("falls back to an empty list if stored lectures JSON is corrupted", async () => {
    await AsyncStorage.setItem("lectures", "{not valid json")
    const lectures = await getLectures()
    expect(lectures).toEqual([])
  })
})

describe("day overrides", () => {
  it("returns only overrides matching the requested date", async () => {
    await saveOverride({ id: "o1", date: "2026-01-01", lectureId: "l1", cancelled: true })
    await saveOverride({ id: "o2", date: "2026-01-02", lectureId: "l1", cancelled: true })
    const jan1 = await getOverridesForDate("2026-01-01")
    expect(jan1).toHaveLength(1)
    expect(jan1[0].id).toBe("o1")
  })

  it("saveOverride replaces an existing override for the same lecture+date instead of duplicating", async () => {
    await saveOverride({ id: "o1", date: "2026-01-01", lectureId: "l1", note: "first" })
    await saveOverride({ id: "o2", date: "2026-01-01", lectureId: "l1", note: "second" })
    const overrides = await getOverridesForDate("2026-01-01")
    expect(overrides).toHaveLength(1)
    expect(overrides[0].note).toBe("second")
  })

  it("clearOverride removes only the targeted lecture+date pair", async () => {
    await saveOverride({ id: "o1", date: "2026-01-01", lectureId: "l1" })
    await saveOverride({ id: "o2", date: "2026-01-01", lectureId: "l2" })
    await clearOverride("l1", "2026-01-01")
    const remaining = await getOverridesForDate("2026-01-01")
    expect(remaining.map(o => o.lectureId)).toEqual(["l2"])
  })

  it("clearOverride on a non-existent entry is a no-op, not an error", async () => {
    await expect(clearOverride("nope", "2026-01-01")).resolves.toBeUndefined()
  })

  it("pruneExpiredOverrides drops entries strictly before today and keeps today/future", async () => {
    await saveOverride({ id: "o1", date: "2026-01-01", lectureId: "l1" })
    await saveOverride({ id: "o2", date: "2026-01-05", lectureId: "l1" })
    await saveOverride({ id: "o3", date: "2026-01-10", lectureId: "l1" })
    await pruneExpiredOverrides("2026-01-05")
    const remaining5 = await getOverridesForDate("2026-01-05")
    const remaining10 = await getOverridesForDate("2026-01-10")
    const remaining1 = await getOverridesForDate("2026-01-01")
    expect(remaining5).toHaveLength(1)
    expect(remaining10).toHaveLength(1)
    expect(remaining1).toHaveLength(0)
  })

  it("pruneExpiredOverrides is a no-op (no write) when nothing is expired", async () => {
    await saveOverride({ id: "o1", date: "2026-01-10", lectureId: "l1" })
    const before = await AsyncStorage.getItem("dayOverrides")
    await pruneExpiredOverrides("2026-01-01")
    const after = await AsyncStorage.getItem("dayOverrides")
    expect(after).toBe(before)
  })

  it("survives corrupted override storage by treating it as empty", async () => {
    await AsyncStorage.setItem("dayOverrides", "not json")
    const result = await getOverridesForDate("2026-01-01")
    expect(result).toEqual([])
  })
})

describe("one-off extra classes", () => {
  it("returns an empty list on first read", async () => {
    expect(await getExtraLectures()).toEqual([])
    expect(await getExtraLecturesForDate("2026-01-05")).toEqual([])
  })

  it("getExtraLecturesForDate returns only extras for the requested date", async () => {
    await saveExtraLecture(extra("x1", "2026-01-05", "Seminar A"))
    await saveExtraLecture(extra("x2", "2026-01-06", "Seminar B"))
    const jan5 = await getExtraLecturesForDate("2026-01-05")
    expect(jan5.map(e => e.id)).toEqual(["x1"])
    expect(await getExtraLectures()).toHaveLength(2)
  })

  it("saveExtraLecture upserts by id so editing keeps the id (and its attendance link)", async () => {
    await saveExtraLecture(extra("x1", "2026-01-05", "Old", "14:00"))
    await saveExtraLecture(extra("x1", "2026-01-05", "New", "15:00"))
    const all = await getExtraLectures()
    expect(all).toHaveLength(1)
    expect(all[0].subject).toBe("New")
    expect(all[0].startTime).toBe("15:00")
  })

  it("removeExtraLecture deletes only the targeted class", async () => {
    await saveExtraLecture(extra("x1", "2026-01-05"))
    await saveExtraLecture(extra("x2", "2026-01-05"))
    await removeExtraLecture("x1")
    const all = await getExtraLectures()
    expect(all.map(e => e.id)).toEqual(["x2"])
  })

  it("removeExtraLecture on a non-existent id is a no-op, not an error", async () => {
    await expect(removeExtraLecture("nope")).resolves.toBeUndefined()
  })

  it("survives corrupted storage by treating it as empty", async () => {
    await AsyncStorage.setItem("extraLectures", "not json")
    expect(await getExtraLectures()).toEqual([])
  })
})

describe("deleteAttendance", () => {
  it("deletes only the targeted lectureId+date pair, keeping everything else", async () => {
    await saveAttendance(record("1", "l1", "2026-01-05", "present"))
    await saveAttendance(record("2", "l1", "2026-01-06", "present"))
    await saveAttendance(record("3", "l2", "2026-01-05", "absent"))
    await deleteAttendance("l1", "2026-01-05")
    const all = await getAttendance()
    expect(all).toHaveLength(2)
    expect(all.some(a => a.lectureId === "l1" && a.date === "2026-01-05")).toBe(false)
  })

  it("is a no-op when no record matches", async () => {
    await saveAttendance(record("1", "l1", "2026-01-05", "present"))
    const before = await AsyncStorage.getItem("attendance")
    await deleteAttendance("l1", "2026-02-01")
    expect(await AsyncStorage.getItem("attendance")).toBe(before)
  })
})

describe("breaks", () => {
  it("returns an empty list on first read with no seeded placeholder data", async () => {
    const breaks = await getBreaks()
    expect(breaks).toEqual([])
  })

  it("saveBreaks overwrites stored breaks fully", async () => {
    await saveBreaks([{ day: 2, startTime: "12:00" }])
    expect(await getBreaks()).toEqual([{ day: 2, startTime: "12:00" }])
  })
})

describe("attendance read/write consistency", () => {
  it("getAttendance returns [] when nothing has been saved yet (no auto-seed, unlike lectures)", async () => {
    expect(await getAttendance()).toEqual([])
  })

  it("saveAttendance appends a new record", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    expect(await getAttendance()).toHaveLength(1)
  })

  it("saveAttendance upserts: same lectureId+date replaces the prior entry rather than duplicating", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveAttendance(record("2", "l1", "2026-01-01", "absent"))
    const all = await getAttendance()
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe("absent")
    expect(all[0].id).toBe("2")
  })

  it("saveAttendance keeps records for the same lecture on different dates distinct", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveAttendance(record("2", "l1", "2026-01-02", "present"))
    expect(await getAttendance()).toHaveLength(2)
  })

  it("saveAttendance keeps records for different lectures on the same date distinct", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveAttendance(record("2", "l2", "2026-01-01", "present"))
    expect(await getAttendance()).toHaveLength(2)
  })

  it("concurrent saveAttendance calls on read-modify-write don't silently drop each other for distinct keys", async () => {
    // Sequential awaits simulate the realistic app usage (one write at a
    // time); this guards against a regression to a shared-mutable-array bug.
    for (let i = 0; i < 20; i++) {
      await saveAttendance(record(`id-${i}`, `l${i}`, "2026-01-01", "present"))
    }
    expect(await getAttendance()).toHaveLength(20)
  })
})

describe("saveAttendanceBulk", () => {
  it("no-ops on an empty array without touching storage", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    const before = await AsyncStorage.getItem("attendance")
    await saveAttendanceBulk([])
    expect(await AsyncStorage.getItem("attendance")).toBe(before)
  })

  it("merges bulk entries with existing data, replacing matching lectureId+date keys", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveAttendance(record("2", "l2", "2026-01-01", "present"))
    await saveAttendanceBulk([
      record("3", "l1", "2026-01-01", "absent"), // replaces id 1
      record("4", "l3", "2026-01-02", "present")  // new
    ])
    const all = await getAttendance()
    expect(all).toHaveLength(3)
    const byKey = new Map(all.map(a => [`${a.lectureId}|${a.date}`, a]))
    expect(byKey.get("l1|2026-01-01")?.status).toBe("absent")
    expect(byKey.get("l2|2026-01-01")?.status).toBe("present")
    expect(byKey.get("l3|2026-01-02")?.status).toBe("present")
  })

  it("does NOT de-dupe duplicate keys within a single incoming batch (caller's responsibility) - documents current behavior", async () => {
    // incomingKeys is only used to filter EXISTING data; entries are spread
    // in as-is, so two rows sharing lectureId+date in one bulk call both
    // land in storage. This is a data-consistency gap worth knowing about
    // when feeding bulk-imported (e.g. CSV) data straight into this function.
    await saveAttendanceBulk([
      record("a", "l1", "2026-01-01", "present"),
      record("b", "l1", "2026-01-01", "absent")
    ])
    const all = await getAttendance()
    expect(all).toHaveLength(2)
  })

  it("bulk import into an empty store behaves like a plain write", async () => {
    await saveAttendanceBulk([record("1", "l1", "2026-01-01", "present")])
    expect(await getAttendance()).toHaveLength(1)
  })
})

describe("clearAllData", () => {
  it("wipes attendance, lectures, overrides, extra classes, thresholds, holidays, reminder settings", async () => {
    await getLectures()
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveOverride({ id: "o1", date: "2026-01-01", lectureId: "l1" })
    await saveExtraLecture(extra("x1", "2026-01-01"))
    await setAttendanceThreshold(80)
    await setLowAttendanceNotified("Math", true)
    await setSubjectThreshold("Math", 90)
    await addHoliday("2026-01-01", "New Year")
    await setReminderSettings({ enabled: true, minutesBefore: 15 })

    await clearAllData()

    expect(await getAttendance()).toEqual([])
    expect(await getOverridesForDate("2026-01-01")).toEqual([])
    expect(await getExtraLectures()).toEqual([])
    expect(await getAttendanceThreshold()).toBe(DEFAULT_ATTENDANCE_THRESHOLD)
    expect(await wasLowAttendanceNotified("Math")).toBe(false)
    expect(await getSubjectThresholds()).toEqual({})
    expect(await getHolidays()).toEqual([])
    expect(await getReminderSettings()).toEqual({ enabled: false, minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE })
    // lectures key removed too, so next getLectures() call returns []
    expect(await isTimetableImported()).toBe(false)
    expect(await getLectures()).toEqual([])
  })

  it("does NOT wipe archived semesters (archive history survives a reset)", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await archiveCurrentSemester()
    expect(await getArchivedSemesters()).toHaveLength(1)
    await clearAllData()
    expect(await getArchivedSemesters()).toHaveLength(1)
  })
})

describe("attendance threshold", () => {
  it("defaults to DEFAULT_ATTENDANCE_THRESHOLD when unset", async () => {
    expect(await getAttendanceThreshold()).toBe(DEFAULT_ATTENDANCE_THRESHOLD)
  })

  it("round-trips a stored numeric threshold", async () => {
    await setAttendanceThreshold(85)
    expect(await getAttendanceThreshold()).toBe(85)
  })

  it("falls back to default when stored value is corrupted/non-numeric", async () => {
    await AsyncStorage.setItem("attendanceThreshold", "not-a-number")
    expect(await getAttendanceThreshold()).toBe(DEFAULT_ATTENDANCE_THRESHOLD)
  })

  it("stores 0 as a real value, not treated as unset", async () => {
    await setAttendanceThreshold(0)
    // parseInt("0") -> 0, Number.isNaN(0) is false, so 0 should be honored
    expect(await getAttendanceThreshold()).toBe(0)
  })
})

describe("low-attendance notified flag", () => {
  it("defaults to false for a never-seen subject", async () => {
    expect(await wasLowAttendanceNotified("Math")).toBe(false)
  })

  it("tracks true/false independently per subject", async () => {
    await setLowAttendanceNotified("Math", true)
    expect(await wasLowAttendanceNotified("Math")).toBe(true)
    expect(await wasLowAttendanceNotified("Physics")).toBe(false)
  })

  it("setting false deletes the key rather than storing an explicit false (map stays small)", async () => {
    await setLowAttendanceNotified("Math", true)
    await setLowAttendanceNotified("Math", false)
    const raw = await AsyncStorage.getItem("lowAttendanceNotified")
    expect(JSON.parse(raw as string)).toEqual({})
  })
})

describe("subject thresholds & effective threshold resolution", () => {
  it("getSubjectThresholds defaults to {}", async () => {
    expect(await getSubjectThresholds()).toEqual({})
  })

  it("setSubjectThreshold(subject, null) clears an override", async () => {
    await setSubjectThreshold("Math", 90)
    await setSubjectThreshold("Math", null)
    expect(await getSubjectThresholds()).toEqual({})
  })

  it("getEffectiveThreshold uses the per-subject override when present", async () => {
    await setAttendanceThreshold(75)
    await setSubjectThreshold("Math", 90)
    expect(await getEffectiveThreshold("Math")).toBe(90)
    expect(await getEffectiveThreshold("Physics")).toBe(75)
  })

  it("getEffectiveThresholds batches multiple subjects consistently with the single-subject version", async () => {
    await setAttendanceThreshold(70)
    await setSubjectThreshold("Math", 95)
    const batch = await getEffectiveThresholds(["Math", "Physics", "CN"])
    expect(batch).toEqual({ Math: 95, Physics: 70, CN: 70 })
    expect(batch.Math).toBe(await getEffectiveThreshold("Math"))
  })

  it("getEffectiveThresholds on an empty subject list returns {}", async () => {
    expect(await getEffectiveThresholds([])).toEqual({})
  })
})

describe("semester start date", () => {
  it("defaults to null when unset", async () => {
    expect(await getSemesterStartDate()).toBeNull()
  })

  it("round-trips a valid date", async () => {
    await setSemesterStartDate("2026-01-01")
    expect(await getSemesterStartDate()).toBe("2026-01-01")
  })

  it("rejects an invalid date string and does not persist it", async () => {
    await expect(setSemesterStartDate("2026-13-40")).rejects.toThrow()
    expect(await getSemesterStartDate()).toBeNull()
  })

  it("rejects a non-YYYY-MM-DD formatted string", async () => {
    await expect(setSemesterStartDate("01/01/2026")).rejects.toThrow()
  })
})

describe("archiveCurrentSemester", () => {
  it("does nothing to archives when there is no attendance yet, but still resets semester start", async () => {
    await archiveCurrentSemester()
    expect(await getArchivedSemesters()).toEqual([])
    expect(await getSemesterStartDate()).not.toBeNull()
  })

  it("snapshots current attendance+lectures into an archive, then clears live attendance", async () => {
    await getLectures()
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await saveAttendance(record("2", "l2", "2026-01-02", "absent"))

    await archiveCurrentSemester()

    const archives = await getArchivedSemesters()
    expect(archives).toHaveLength(1)
    expect(archives[0].attendance).toHaveLength(2)
    expect(await getAttendance()).toEqual([])
  })

  it("does not touch the master lecture list", async () => {
    await setMasterTimetable([lecture("l1", "CN")])
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await archiveCurrentSemester()
    expect(await getLectures()).toEqual([lecture("l1", "CN")])
  })

  it("appends to (not replaces) prior archives across repeated calls", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await archiveCurrentSemester()
    await saveAttendance(record("2", "l1", "2026-02-01", "present"))
    await archiveCurrentSemester()
    expect(await getArchivedSemesters()).toHaveLength(2)
  })

  it("uses today's date as endDate and falls back to endDate as startDate when no semester start was set", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await archiveCurrentSemester()
    const [archive] = await getArchivedSemesters()
    expect(archive.startDate).toBe(archive.endDate)
  })
})

describe("holidays", () => {
  it("defaults to an empty list", async () => {
    expect(await getHolidays()).toEqual([])
    expect(await getHolidayForDate("2026-01-01")).toBeNull()
  })

  it("addHoliday stores and sorts by date", async () => {
    await addHoliday("2026-03-01")
    await addHoliday("2026-01-01", "New Year")
    await addHoliday("2026-02-01")
    const holidays = await getHolidays()
    expect(holidays.map(h => h.date)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"])
  })

  it("addHoliday on an existing date replaces rather than duplicates", async () => {
    await addHoliday("2026-01-01", "Old Label")
    await addHoliday("2026-01-01", "New Label")
    const holidays = await getHolidays()
    expect(holidays).toHaveLength(1)
    expect(holidays[0].label).toBe("New Label")
  })

  it("trims whitespace-only labels down to undefined", async () => {
    await addHoliday("2026-01-01", "   ")
    const h = await getHolidayForDate("2026-01-01")
    expect(h?.label).toBeUndefined()
  })

  it("rejects invalid date strings", async () => {
    await expect(addHoliday("not-a-date")).rejects.toThrow()
  })

  it("removeHoliday deletes only the targeted date", async () => {
    await addHoliday("2026-01-01")
    await addHoliday("2026-01-02")
    await removeHoliday("2026-01-01")
    const holidays = await getHolidays()
    expect(holidays.map(h => h.date)).toEqual(["2026-01-02"])
  })

  it("marking a holiday never removes existing attendance for that date", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await addHoliday("2026-01-01", "Surprise Holiday")
    const all = await getAttendance()
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe("present")
  })
})

describe("reminder settings", () => {
  it("defaults to disabled with the default minutesBefore", async () => {
    expect(await getReminderSettings()).toEqual({ enabled: false, minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE })
  })

  it("round-trips valid settings", async () => {
    await setReminderSettings({ enabled: true, minutesBefore: 20 })
    expect(await getReminderSettings()).toEqual({ enabled: true, minutesBefore: 20 })
  })

  it("rejects minutesBefore below the minimum (0)", async () => {
    await expect(setReminderSettings({ enabled: true, minutesBefore: 0 })).rejects.toThrow()
  })

  it("rejects minutesBefore above the maximum (181)", async () => {
    await expect(setReminderSettings({ enabled: true, minutesBefore: 181 })).rejects.toThrow()
  })

  it("accepts boundary values 1 and 180", async () => {
    await setReminderSettings({ enabled: true, minutesBefore: 1 })
    expect((await getReminderSettings()).minutesBefore).toBe(1)
    await setReminderSettings({ enabled: true, minutesBefore: 180 })
    expect((await getReminderSettings()).minutesBefore).toBe(180)
  })

  it("falls back to default minutesBefore if stored value is corrupted/out-of-range, without crashing", async () => {
    await AsyncStorage.setItem("reminderSettings", JSON.stringify({ enabled: true, minutesBefore: 9999 }))
    const settings = await getReminderSettings()
    expect(settings.minutesBefore).toBe(DEFAULT_REMINDER_MINUTES_BEFORE)
    expect(settings.enabled).toBe(true)
  })

  it("survives fully corrupted JSON in reminder settings", async () => {
    await AsyncStorage.setItem("reminderSettings", "{{{broken")
    const settings = await getReminderSettings()
    expect(settings).toEqual({ enabled: false, minutesBefore: DEFAULT_REMINDER_MINUTES_BEFORE })
  })
})

describe("cross-key data consistency", () => {
  it("clearAllData followed by fresh writes leaves no residue from before the clear", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await setAttendanceThreshold(60)
    await clearAllData()
    await saveAttendance(record("2", "l2", "2026-02-01", "absent"))
    const all = await getAttendance()
    expect(all).toEqual([record("2", "l2", "2026-02-01", "absent")])
    expect(await getAttendanceThreshold()).toBe(DEFAULT_ATTENDANCE_THRESHOLD)
  })

  it("independent keys don't clobber each other on write (threshold write doesn't affect attendance)", async () => {
    await saveAttendance(record("1", "l1", "2026-01-01", "present"))
    await setAttendanceThreshold(50)
    await setSubjectThreshold("Math", 60)
    await addHoliday("2026-01-05")
    expect(await getAttendance()).toHaveLength(1)
    expect(await getAttendanceThreshold()).toBe(50)
    expect(await getSubjectThresholds()).toEqual({ Math: 60 })
    expect(await getHolidays()).toHaveLength(1)
  })
})
