import * as Notifications from "expo-notifications"
import { scheduleClassReminders, cancelAllClassReminders } from "../notifications"
import { Lecture } from "../../types"

const lecture = (overrides: Partial<Lecture> = {}): Lecture => ({
  id: "l1",
  subject: "Math",
  day: 1, // Monday
  startTime: "09:00",
  ...overrides
})

describe("scheduleClassReminders", () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  it("cancels existing reminders before scheduling new ones (idempotent re-scheduling)", async () => {
    const cancelSpy = jest.spyOn(Notifications, "getAllScheduledNotificationsAsync")
    await scheduleClassReminders([lecture()], 10)
    expect(cancelSpy).toHaveBeenCalled()
  })

  it("converts JS day-of-week (0=Sun) to expo weekday (1=Sun) correctly", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await scheduleClassReminders([lecture({ day: 1, startTime: "09:00" })], 10) // Monday
    const call = scheduleSpy.mock.calls[0][0] as any
    expect(call.trigger.weekday).toBe(2) // Monday: JS day 1 -> expo weekday 2
    expect(call.trigger.hour).toBe(8)
    expect(call.trigger.minute).toBe(50)
  })

  it("rolls the reminder back to the previous weekday when it crosses midnight", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    // Monday 00:05 class, 10 min before -> Sunday 23:55
    await scheduleClassReminders([lecture({ day: 1, startTime: "00:05" })], 10)
    const call = scheduleSpy.mock.calls[0][0] as any
    expect(call.trigger.weekday).toBe(1) // Sunday
    expect(call.trigger.hour).toBe(23)
    expect(call.trigger.minute).toBe(55)
  })

  it("rolls Sunday back to Saturday when crossing midnight", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    // Sunday 00:00 class, 1 min before -> Saturday 23:59
    await scheduleClassReminders([lecture({ day: 0, startTime: "00:00" })], 1)
    const call = scheduleSpy.mock.calls[0][0] as any
    expect(call.trigger.weekday).toBe(7) // Saturday
    expect(call.trigger.hour).toBe(23)
    expect(call.trigger.minute).toBe(59)
  })

  it("handles a reminder window large enough to cross more than one day boundary conceptually (large minutesBefore)", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    // Monday 00:30 class, 60 min before -> Sunday 23:30
    await scheduleClassReminders([lecture({ day: 1, startTime: "00:30" })], 60)
    const call = scheduleSpy.mock.calls[0][0] as any
    expect(call.trigger.weekday).toBe(1) // Sunday
    expect(call.trigger.hour).toBe(23)
    expect(call.trigger.minute).toBe(30)
  })

  it("skips lectures with malformed startTime instead of throwing", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await scheduleClassReminders(
      [lecture({ id: "bad", startTime: "not-a-time" }), lecture({ id: "good", startTime: "10:00" })],
      10
    )
    // Only the well-formed lecture should have been scheduled.
    expect(scheduleSpy).toHaveBeenCalledTimes(1)
  })

  it("schedules nothing and does not throw for an empty lecture list", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await expect(scheduleClassReminders([], 10)).resolves.toBeUndefined()
    expect(scheduleSpy).not.toHaveBeenCalled()
  })

  it("uses a distinct identifier per lecture so re-scheduling doesn't create duplicates", async () => {
    const scheduleSpy = jest.spyOn(Notifications, "scheduleNotificationAsync")
    await scheduleClassReminders(
      [lecture({ id: "l1" }), lecture({ id: "l2", subject: "Physics" })],
      10
    )
    const ids = scheduleSpy.mock.calls.map(c => (c[0] as any).identifier)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => id.startsWith("class-reminder-"))).toBe(true)
  })
})

describe("cancelAllClassReminders", () => {
  it("only cancels notifications with the class-reminder prefix", async () => {
    jest.spyOn(Notifications, "getAllScheduledNotificationsAsync").mockResolvedValue([
      { identifier: "class-reminder-l1", content: {} as any, trigger: null },
      { identifier: "some-other-notification", content: {} as any, trigger: null }
    ] as any)
    const cancelSpy = jest.spyOn(Notifications, "cancelScheduledNotificationAsync")
    await cancelAllClassReminders()
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledWith("class-reminder-l1")
  })

  it("does not throw if listing scheduled notifications fails", async () => {
    jest.spyOn(Notifications, "getAllScheduledNotificationsAsync").mockRejectedValue(new Error("boom"))
    await expect(cancelAllClassReminders()).resolves.toBeUndefined()
  })
})
