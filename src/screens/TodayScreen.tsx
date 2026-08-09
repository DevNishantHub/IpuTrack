// src/screens/TodayScreen.tsx
import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView, Modal, TextInput, TouchableOpacity } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { MaterialIcons } from "@expo/vector-icons"
import {
  getLectures,
  getAttendance,
  saveAttendance,
  getOverridesForDate,
  saveOverride,
  clearOverride,
  pruneExpiredOverrides,
  getHolidayForDate,
  removeHoliday
} from "../storage/storage"
import { Lecture, Attendance, AttendanceStatus, DayOverride, Holiday } from "../types"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import MdButton from "../components/MdButton"
import {
  toMinutes,
  getTodayDate,
  getDayOfWeek,
  addDaysToDate,
  isValidDateString,
  formatDisplayDate
} from "../utils/dateHelpers"
import { checkLowAttendanceAndNotify } from "../utils/attendance"
import { CLASS_SUBJECTS, LAB_SUBJECTS } from "../data/subjects"

const STATUS_META: Record<AttendanceStatus, { label: string; color: string; bg: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  present: { label: "Present", color: colors.success, bg: colors.successContainer, icon: "check-circle" },
  absent: { label: "Absent", color: colors.error, bg: colors.errorContainer, icon: "cancel" },
  cancelled: { label: "Cancelled", color: colors.onSurfaceVariant, bg: colors.neutralContainer, icon: "block" }
}

// A lecture merged with today's override (if any) for display purposes only.
// The underlying master lecture id (used for attendance) never changes.
type DisplayLecture = Lecture & { overridden: boolean }

const ALL_SUBJECTS = [...CLASS_SUBJECTS, ...LAB_SUBJECTS]

export default function TodayScreen() {
  // The date currently being viewed/marked - defaults to today, but can be
  // navigated backwards (or forwards, for preview) to backfill missed days.
  const [selectedDate, setSelectedDate] = useState(getTodayDate())
  const [showDateJump, setShowDateJump] = useState(false)
  const [dateJumpInput, setDateJumpInput] = useState("")
  const [dateJumpError, setDateJumpError] = useState<string | null>(null)

  const [displayLectures, setDisplayLectures] = useState<DisplayLecture[]>([])
  const [dayAttendance, setDayAttendance] = useState<Attendance[]>([])
  const [holiday, setHoliday] = useState<Holiday | null>(null)
  const [editing, setEditing] = useState<DisplayLecture | null>(null)
  const [editSubject, setEditSubject] = useState("")
  const [editTime, setEditTime] = useState("")
  const [editNote, setEditNote] = useState("")

  useEffect(() => {
    load()
    // Re-load whenever the viewed date changes, so switching days always
    // shows that day's lectures/overrides/attendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  const load = async (preloaded?: { allLectures: Lecture[]; allAttendance: Attendance[] }) => {
    const todayDate = getTodayDate()
    // Overrides only ever apply to "today" by design (they auto-expire), so
    // pruning is still anchored to the real today, not the viewed date.
    await pruneExpiredOverrides(todayDate)

    const [allLectures, allAttendance, overrides, holidayForDate] = await Promise.all([
      preloaded ? Promise.resolve(preloaded.allLectures) : getLectures(),
      preloaded ? Promise.resolve(preloaded.allAttendance) : getAttendance(),
      getOverridesForDate(selectedDate),
      getHolidayForDate(selectedDate)
    ])

    setHoliday(holidayForDate)

    const overrideFor = (id: string) => overrides.find(o => o.lectureId === id)

    const merged: DisplayLecture[] = allLectures
      .filter((l: Lecture) => l.day === getDayOfWeek(selectedDate))
      .map(l => {
        const o = overrideFor(l.id)
        if (!o) return { ...l, overridden: false }
        return {
          ...l,
          subject: o.subject ?? l.subject,
          startTime: o.startTime ?? l.startTime,
          note: o.note ?? l.note,
          overridden: true
        }
      })
      .filter(l => {
        const o = overrideFor(l.id)
        return !(o && o.cancelled)
      })
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))

    setDisplayLectures(merged)
    setDayAttendance(allAttendance.filter((a: Attendance) => a.date === selectedDate))
  }

  const mark = async (lectureId: string, status: AttendanceStatus) => {
    // Always keyed by the master lectureId + the viewed date, so backfilling
    // a past day writes attendance against that day, not today.
    // Date.now() alone can collide if two marks land in the same
    // millisecond (rapid taps); the random suffix makes IDs unique
    // regardless of timing.
    await saveAttendance({
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lectureId,
      date: selectedDate,
      status
    })

    // Fetched once here and reused below for both the notify check and the
    // reload, instead of hitting AsyncStorage twice per tap.
    const [allLectures, allAttendance] = await Promise.all([getLectures(), getAttendance()])

    // Check for low attendance notification (only for present/absent).
    // Awaited (and run before load()) so the notified-flag write in
    // AsyncStorage always finishes before the next mark() or reload can
    // read/write it - avoids double-notify and missed-reset races.
    if (status !== "cancelled") {
      await checkLowAttendanceAndNotify(lectureId, allLectures, allAttendance)
    }

    await load({ allLectures, allAttendance })
  }

  const statusFor = (lectureId: string) =>
    dayAttendance.find(a => a.lectureId === lectureId)?.status

  const goToDate = (dateStr: string) => {
    setSelectedDate(dateStr)
    setShowDateJump(false)
    setDateJumpError(null)
  }

  const submitDateJump = () => {
    const trimmed = dateJumpInput.trim()
    if (!isValidDateString(trimmed)) {
      setDateJumpError("Enter a date as YYYY-MM-DD")
      return
    }
    goToDate(trimmed)
    setDateJumpInput("")
  }

  const isViewingToday = selectedDate === getTodayDate()

  const openEdit = (l: DisplayLecture) => {
    setEditing(l)
    setEditSubject(l.subject)
    setEditTime(l.startTime)
    setEditNote(l.note ?? "")
  }

  const closeEdit = () => setEditing(null)

  const saveTodayEdit = async () => {
    if (!editing) return
    if (!/^\d{1,2}:\d{2}$/.test(editTime.trim())) return
    await saveOverride({
      id: `${editing.id}-${selectedDate}`,
      date: selectedDate,
      lectureId: editing.id,
      subject: editSubject.trim() || editing.subject,
      startTime: editTime.trim(),
      note: editNote.trim() || undefined
    })
    setEditing(null)
    await load()
  }

  const cancelToday = async () => {
    if (!editing) return
    await saveOverride({
      id: `${editing.id}-${selectedDate}`,
      date: selectedDate,
      lectureId: editing.id,
      cancelled: true
    })
    setEditing(null)
    await load()
  }

  const revertToday = async () => {
    if (!editing) return
    await clearOverride(editing.id, selectedDate)
    setEditing(null)
    await load()
  }

  const undoHoliday = async () => {
    await removeHoliday(selectedDate)
    await load()
  }

  const viewedDateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric"
  })

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.dateNavRow}>
          <TouchableOpacity
            onPress={() => goToDate(addDaysToDate(selectedDate, -1))}
            style={styles.dateNavArrow}
          >
            <MaterialIcons name="chevron-left" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dateNavLabelWrap}
            onPress={() => {
              setDateJumpInput(selectedDate)
              setShowDateJump(v => !v)
            }}
          >
            <Text style={styles.dateLabel}>{formatDisplayDate(selectedDate)}</Text>
            <Text style={styles.dateSubLabel}>{viewedDateLabel}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => goToDate(addDaysToDate(selectedDate, 1))}
            style={styles.dateNavArrow}
          >
            <MaterialIcons name="chevron-right" size={22} color={colors.onSurfaceVariant} />
          </TouchableOpacity>
        </View>

        {!isViewingToday && (
          <MdButton
            title="Back to today"
            variant="text"
            onPress={() => goToDate(getTodayDate())}
            style={styles.backToTodayBtn}
          />
        )}

        {showDateJump && (
          <View style={styles.dateJumpCard}>
            <Text style={styles.label}>Jump to date (YYYY-MM-DD)</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={dateJumpInput}
                onChangeText={t => {
                  setDateJumpInput(t)
                  setDateJumpError(null)
                }}
                placeholder={getTodayDate()}
                autoCapitalize="none"
              />
              <MdButton title="Go" variant="filled" onPress={submitDateJump} />
            </View>
            {dateJumpError && <Text style={styles.errorTextInline}>{dateJumpError}</Text>}
          </View>
        )}

        {!isViewingToday && (
          <View style={styles.backfillBanner}>
            <MaterialIcons name="history" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.backfillBannerText}>
              Viewing {viewedDateLabel}. Mark attendance below to backfill this day.
            </Text>
          </View>
        )}

        {holiday && (
          <View style={styles.holidayCard}>
            <MaterialIcons name="celebration" size={32} color={colors.primary} />
            <Text style={styles.holidayTitle}>{holiday.label || "College Holiday"}</Text>
            <Text style={styles.holidayBody}>
              No classes marked as scheduled for this date. Attendance marking is hidden while
              this date is set as a holiday.
            </Text>
            <MdButton
              title="Not a holiday - undo"
              variant="text"
              onPress={undoHoliday}
              style={styles.actionBtn}
            />
          </View>
        )}

        {!holiday && displayLectures.length === 0 && (
          <View style={styles.emptyCard}>
            <MaterialIcons name="event-available" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.empty}>No lectures scheduled for today.</Text>
          </View>
        )}

        {!holiday && displayLectures.map(l => {
          const current = statusFor(l.id)
          const meta = current ? STATUS_META[current] : null
          return (
            <View key={l.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{l.subject}</Text>
                    {l.overridden && (
                      <View style={styles.editedBadge}>
                        <Text style={styles.editedBadgeText}>Edited for today</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.time}>
                    {l.startTime}
                    {l.note ? `  ·  ${l.note}` : ""}
                  </Text>
                </View>
                {meta && (
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <MaterialIcons name={meta.icon} size={14} color={meta.color} />
                    <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                )}
                <MdButton
                  title="Edit"
                  variant="text"
                  onPress={() => openEdit(l)}
                  style={styles.editBtn}
                />
              </View>
              <View style={styles.buttonRow}>
                <MdButton
                  title="Present"
                  variant={current === "present" ? "filled" : "tonal"}
                  onPress={() => mark(l.id, "present")}
                />
                <MdButton
                  title="Absent"
                  variant={current === "absent" ? "danger" : "outlined"}
                  onPress={() => mark(l.id, "absent")}
                />
                <MdButton
                  title="Cancelled"
                  variant="text"
                  onPress={() => mark(l.id, "cancelled")}
                />
              </View>
            </View>
          )
        })}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change just for today</Text>
            <Text style={styles.modalSubtitle}>
              This only affects {editing?.subject} today. Your permanent timetable stays the same.
            </Text>

            <Text style={styles.label}>Subject</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {ALL_SUBJECTS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, editSubject === s && styles.chipActive]}
                  onPress={() => setEditSubject(s)}
                >
                  <Text style={editSubject === s ? styles.chipTextActive : styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Time (HH:MM)</Text>
            <TextInput style={styles.input} value={editTime} onChangeText={setEditTime} placeholder="10:00" />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={editNote} onChangeText={setEditNote} placeholder="e.g. room 512" />

            <View style={styles.modalButtonsRow}>
              <MdButton title="Cancel class today" variant="danger" onPress={cancelToday} />
              {editing?.overridden && (
                <MdButton title="Revert to normal" variant="text" onPress={revertToday} />
              )}
            </View>
            <View style={styles.modalButtonsRow}>
              <MdButton title="Close" variant="text" onPress={closeEdit} />
              <MdButton title="Save for today" variant="filled" onPress={saveTodayEdit} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing(4) },
  dateNavRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing(1)
  },
  dateNavArrow: { padding: spacing(2) },
  dateNavLabelWrap: { alignItems: "center", flex: 1 },
  dateLabel: { ...typo.label, textTransform: "uppercase", letterSpacing: 0.5 },
  dateSubLabel: { ...typo.body, color: colors.onSurfaceVariant, marginTop: 2, fontSize: 12 },
  backToTodayBtn: { alignSelf: "center", marginBottom: spacing(1) },
  dateJumpCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(3),
    marginBottom: spacing(3),
    ...elevation[1]
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing(2) },
  errorTextInline: { fontSize: 12, color: colors.error, marginTop: spacing(1) },
  backfillBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.neutralContainer,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(3)
  },
  backfillBannerText: { flex: 1, fontSize: 12, color: colors.onSurfaceVariant, lineHeight: 16 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(8),
    alignItems: "center",
    gap: spacing(2)
  },
  empty: { ...typo.body, color: colors.onSurfaceVariant, textAlign: "center" },
  holidayCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.lg,
    padding: spacing(8),
    alignItems: "center",
    gap: spacing(2),
    marginBottom: spacing(3)
  },
  holidayTitle: { ...typo.title, textAlign: "center" },
  holidayBody: { ...typo.body, color: colors.onSurfaceVariant, textAlign: "center" },
  actionBtn: { marginTop: spacing(2) },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginBottom: spacing(3),
    ...elevation[1]
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing(3)
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing(2), flexWrap: "wrap" },
  title: { ...typo.title },
  time: { ...typo.body, color: colors.onSurfaceVariant, marginTop: 2 },
  editedBadge: {
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: 8
  },
  editedBadgeText: { fontSize: 10, fontWeight: "600", color: colors.primaryDark },
  editBtn: { paddingHorizontal: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.full
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  buttonRow: { flexDirection: "row", gap: spacing(2), flexWrap: "wrap" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: spacing(5)
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(5)
  },
  modalTitle: { ...typo.title, marginBottom: spacing(1) },
  modalSubtitle: { ...typo.body, color: colors.onSurfaceVariant, marginBottom: spacing(3) },
  label: { ...typo.label, marginTop: spacing(2), marginBottom: spacing(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing(2.5),
    borderRadius: radius.sm,
    color: colors.onSurface
  },
  modalButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing(2),
    marginTop: spacing(4)
  },
  chipRow: { marginTop: spacing(1) },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.outline,
    marginRight: spacing(2)
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.onSurface },
  chipTextActive: { color: colors.onPrimary, fontWeight: "600" }
})
