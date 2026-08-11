// src/screens/TodayScreen.tsx
import { useCallback, useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView, Modal, TextInput, TouchableOpacity } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
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
  removeHoliday,
  getExtraLecturesForDate,
  saveExtraLecture,
  removeExtraLecture,
  deleteAttendance
} from "../storage/storage"
import { Lecture, Attendance, AttendanceStatus, Holiday } from "../types"
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
import { slugifyId, timeTokenForId } from "../utils/timetableImport"
import { CLASS_SUBJECTS, LAB_SUBJECTS } from "../data/subjects"

const STATUS_META: Record<AttendanceStatus, { label: string; color: string; bg: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  present: { label: "Present", color: colors.success, bg: colors.successContainer, icon: "check-circle" },
  absent: { label: "Absent", color: colors.error, bg: colors.errorContainer, icon: "cancel" },
  cancelled: { label: "Cancelled", color: colors.onSurfaceVariant, bg: colors.neutralContainer, icon: "block" }
}

// A lecture merged with today's override (if any) for display purposes only.
// The underlying master lecture id (used for attendance) never changes.
// `isExtra` marks one-off classes added for this exact date - they have no
// master lecture behind them (see ExtraLecture).
type DisplayLecture = Lecture & { overridden: boolean; isExtra?: boolean }

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

  // Classes hidden for this day via Remove (cancelled override), so the user
  // can restore them instead of being stuck with an irreversible removal.
  const [removedLectures, setRemovedLectures] = useState<DisplayLecture[]>([])
  // The class the user is being asked to confirm removing. Rendered as an
  // inline confirm (on the card, or inside the edit modal) instead of a
  // native Alert - RN Web's Alert is a no-op, so a native dialog would
  // silently do nothing on web while the rest of the screen works.
  const [confirmingRemove, setConfirmingRemove] = useState<DisplayLecture | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addSubject, setAddSubject] = useState("")
  const [addTime, setAddTime] = useState("")
  const [addNote, setAddNote] = useState("")

  // Prune stale overrides exactly once, on mount - NOT on every load(). If
  // this ran inside load() (which fires again right after saving an edit),
  // it would delete the override you just created whenever you're backfilling
  // a past day, since that override's date is before the real today. That
  // made editing a previous day look like it silently failed.
  useEffect(() => {
    // Fire-and-forget: the override prune is best-effort cleanup, so a
    // storage failure here must not surface as an unhandled rejection.
    pruneExpiredOverrides(getTodayDate()).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    load()
    // Re-load whenever the viewed date changes, so switching days always
    // shows that day's lectures/overrides/attendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate])

  // The tab navigator keeps this screen mounted across tab switches (lazy
  // mount, no unmountOnBlur), so the date-keyed effect above only fires
  // once per selectedDate and never again just from revisiting the tab.
  // Without this, attendance/lectures/overrides changed elsewhere (CSV
  // import, timetable edit, holiday add) while this screen sat in the
  // background wouldn't show up until the viewed date happened to change.
  // Refetching on every focus makes storage the single source of truth
  // this screen always reflects, instead of a snapshot taken once at mount.
  useFocusEffect(
    useCallback(() => {
      load()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate])
  )

  const load = async (preloaded?: { allLectures: Lecture[]; allAttendance: Attendance[] }) => {
    const [allLectures, allAttendance, overrides, holidayForDate, extras] = await Promise.all([
      preloaded ? Promise.resolve(preloaded.allLectures) : getLectures(),
      preloaded ? Promise.resolve(preloaded.allAttendance) : getAttendance(),
      getOverridesForDate(selectedDate),
      getHolidayForDate(selectedDate),
      getExtraLecturesForDate(selectedDate)
    ])

    setHoliday(holidayForDate)

    const overrideFor = (id: string) => overrides.find(o => o.lectureId === id)

    const dayLectures = allLectures.filter((l: Lecture) => l.day === getDayOfWeek(selectedDate))

    // Master-timetable lectures merged with today's override (if any), minus
    // any removed for this day - those land in `removed` below so they can
    // be restored. One-off classes added for this date are appended.
    const merged: DisplayLecture[] = [
      ...dayLectures
        .map(l => {
          const o = overrideFor(l.id)
          if (!o) return { ...l, overridden: false, isExtra: false }
          return {
            ...l,
            subject: o.subject ?? l.subject,
            startTime: o.startTime ?? l.startTime,
            note: o.note ?? l.note,
            overridden: true,
            isExtra: false
          }
        })
        .filter(l => {
          const o = overrideFor(l.id)
          return !(o && o.cancelled)
        }),
      ...extras.map(e => ({
        id: e.id,
        subject: e.subject,
        day: getDayOfWeek(selectedDate),
        startTime: e.startTime,
        note: e.note,
        overridden: false,
        isExtra: true
      }))
    ].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))

    // Classes removed for this day (cancelled override), shown in the
    // "Removed for this day" section with a Restore action.
    const removed: DisplayLecture[] = dayLectures
      .map(l => {
        const o = overrideFor(l.id)
        if (!o || !o.cancelled) return null
        return {
          ...l,
          subject: o.subject ?? l.subject,
          startTime: o.startTime ?? l.startTime,
          note: o.note ?? l.note,
          overridden: true,
          isExtra: false
        } as DisplayLecture
      })
      .filter((l): l is DisplayLecture => l !== null)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))

    setDisplayLectures(merged)
    setRemovedLectures(removed)
    setDayAttendance(allAttendance.filter((a: Attendance) => a.date === selectedDate))
  }

  const mark = async (lectureId: string, status: AttendanceStatus) => {
    // Always keyed by the master lectureId + the viewed date, so backfilling
    // a past day writes attendance against that day, not today. The record
    // id is the deterministic lectureId-date pair (the same key the storage
    // layer upserts on), so the same class+day always has the same id.
    await saveAttendance({
      id: `${lectureId}-${selectedDate}`,
      lectureId,
      date: selectedDate,
      status
    })

    // Fetched once here and reused below for both the notify check and the
    // reload, instead of hitting AsyncStorage twice per tap.
    const [allLectures, allAttendance] = await Promise.all([getLectures(), getAttendance()])

    // Check for low attendance notification (only for present/absent).
    // Skipped for one-off added classes: they're not in the master
    // timetable, so there's no subject to resolve a threshold against -
    // checkLowAttendanceAndNotify would only log a "no lecture found"
    // warning on every tap. Awaited (and run before load()) so the
    // notified-flag write in AsyncStorage always finishes before the next
    // mark() or reload can read/write it - avoids double-notify and
    // missed-reset races.
    const isExtra = displayLectures.find(l => l.id === lectureId)?.isExtra
    if (status !== "cancelled" && !isExtra) {
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
    if (editing.isExtra) {
      // A one-off added class is edited in place - same id, so any
      // attendance already recorded against it stays linked.
      await saveExtraLecture({
        id: editing.id,
        date: selectedDate,
        subject: editSubject.trim() || editing.subject,
        startTime: editTime.trim(),
        note: editNote.trim() || undefined
      })
    } else {
      await saveOverride({
        id: `${editing.id}-${selectedDate}`,
        date: selectedDate,
        lectureId: editing.id,
        subject: editSubject.trim() || editing.subject,
        startTime: editTime.trim(),
        note: editNote.trim() || undefined
      })
    }
    setEditing(null)
    await load()
  }

  // Ask for confirmation before removing. Removing deletes that day's
  // attendance, so it must be explicit - but the confirm is rendered inline
  // (see the card/modal below) rather than via a native Alert, so it works
  // on every platform the app runs on, including web.
  const confirmRemove = (l: DisplayLecture) => setConfirmingRemove(l)

  const cancelRemove = () => setConfirmingRemove(null)

  // Removes a class for the selected day only. For a master-timetable class
  // this writes a cancelled override (it stays in the weekly timetable); for
  // an added one-off class it deletes the class itself. Either way, any
  // attendance recorded for that (class, date) is deleted too, so the class
  // is fully gone from stats and from CSV export/import for that day.
  const doRemove = async (l: DisplayLecture) => {
    setConfirmingRemove(null)
    try {
      if (l.isExtra) {
        await removeExtraLecture(l.id)
      } else {
        await saveOverride({
          id: `${l.id}-${selectedDate}`,
          date: selectedDate,
          lectureId: l.id,
          cancelled: true
        })
      }
      await deleteAttendance(l.id, selectedDate)
    } catch (err) {
      console.warn("Failed to remove class for the day:", err)
    }
    setEditing(null)
    await load()
  }

  const restoreRemoved = async (l: DisplayLecture) => {
    await clearOverride(l.id, selectedDate)
    await load()
  }

  const openAdd = () => {
    setAddSubject(ALL_SUBJECTS[0])
    setAddTime("")
    setAddNote("")
    setShowAddModal(true)
  }

  const closeAdd = () => setShowAddModal(false)

  const saveAdd = async () => {
    const time = addTime.trim()
    if (!/^\d{1,2}:\d{2}$/.test(time)) return
    // Deterministic classname-date id (subject-date-time), same scheme as
    // timetable lectures - and adding the exact same class twice simply
    // upserts instead of creating a duplicate.
    const subject = addSubject.trim() || ALL_SUBJECTS[0]
    await saveExtraLecture({
      id: `${slugifyId(subject)}-${selectedDate}-${timeTokenForId(time)}`,
      date: selectedDate,
      subject,
      startTime: time,
      note: addNote.trim() || undefined
    })
    closeAdd()
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
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
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

        {!holiday && (
          <MdButton
            title="Add class for this day"
            variant="outlined"
            onPress={openAdd}
            style={styles.addClassBtn}
          />
        )}

        {!holiday && displayLectures.length === 0 && (
          <View style={styles.emptyCard}>
            <MaterialIcons name="event-available" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.empty}>
              No lectures scheduled for this day. Use "Add class for this day" to add a one-off class.
            </Text>
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
                    {l.isExtra && (
                      <View style={styles.addedBadge}>
                        <Text style={styles.addedBadgeText}>Added for today</Text>
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
              {confirmingRemove?.id === l.id ? (
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmText}>
                    {l.isExtra
                      ? `Remove "${l.subject}" at ${l.startTime} for ${selectedDate}? It only exists on this date, and any attendance you marked for it that day will be deleted.`
                      : `Remove "${l.subject}" at ${l.startTime} for ${selectedDate}? It stays in your weekly timetable (hidden for this day only), and any attendance you marked for it that day will be deleted.`}
                  </Text>
                  <View style={styles.confirmButtons}>
                    <MdButton title="Keep" variant="text" onPress={cancelRemove} />
                    <MdButton title="Remove" variant="danger" onPress={() => doRemove(l)} />
                  </View>
                </View>
              ) : (
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
                    title="Remove"
                    variant="text"
                    onPress={() => confirmRemove(l)}
                    style={styles.removeBtn}
                  />
                </View>
              )}
            </View>
          )
        })}

        {!holiday && removedLectures.length > 0 && (
          <View>
            <Text style={styles.removedLabel}>REMOVED FOR THIS DAY</Text>
            {removedLectures.map(l => (
              <View key={l.id} style={styles.removedCard}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.removedTitle}>{l.subject}</Text>
                  <Text style={styles.removedTime}>
                    {l.startTime}
                    {l.note ? `  ·  ${l.note}` : ""}
                  </Text>
                </View>
                <MdButton title="Restore" variant="text" onPress={() => restoreRemoved(l)} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={closeEdit}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change just for today</Text>
            <Text style={styles.modalSubtitle}>
              {editing?.isExtra
                ? `This class only exists on ${selectedDate}, so changes apply here only.`
                : `This only affects ${editing?.subject} today. Your permanent timetable stays the same.`}
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

            {confirmingRemove?.id === editing?.id ? (
              <View style={styles.confirmCard}>
                <Text style={styles.confirmText}>
                  {editing?.isExtra
                    ? `Remove "${editing?.subject}" for ${selectedDate}? It only exists on this date, and any attendance you marked for it that day will be deleted.`
                    : `Remove "${editing?.subject}" for ${selectedDate}? It stays in your weekly timetable (hidden for this day only), and any attendance you marked for it that day will be deleted.`}
                </Text>
                <View style={styles.confirmButtons}>
                  <MdButton title="Keep" variant="text" onPress={cancelRemove} />
                  <MdButton title="Remove" variant="danger" onPress={() => editing && doRemove(editing)} />
                </View>
              </View>
            ) : (
              <>
                <View style={styles.modalButtonsRow}>
                  <MdButton title="Remove class for today" variant="danger" onPress={() => editing && confirmRemove(editing)} />
                  {editing?.overridden && !editing?.isExtra && (
                    <MdButton title="Revert to normal" variant="text" onPress={revertToday} />
                  )}
                </View>
                <View style={styles.modalButtonsRow}>
                  <MdButton title="Close" variant="text" onPress={closeEdit} />
                  <MdButton title="Save for today" variant="filled" onPress={saveTodayEdit} />
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showAddModal} transparent animationType="fade" onRequestClose={closeAdd}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add class for {selectedDate}</Text>
            <Text style={styles.modalSubtitle}>
              A one-off class for this day only - it won't appear on any other day.
            </Text>

            <Text style={styles.label}>Subject</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {ALL_SUBJECTS.map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, addSubject === s && styles.chipActive]}
                  onPress={() => setAddSubject(s)}
                >
                  <Text style={addSubject === s ? styles.chipTextActive : styles.chipText}>{s}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Time (HH:MM)</Text>
            <TextInput style={styles.input} value={addTime} onChangeText={setAddTime} placeholder="10:00" />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={styles.input} value={addNote} onChangeText={setAddNote} placeholder="e.g. room 512" />

            <View style={styles.modalButtonsRow}>
              <MdButton title="Close" variant="text" onPress={closeAdd} />
              <MdButton title="Add class" variant="filled" onPress={saveAdd} />
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
  chipTextActive: { color: colors.onPrimary, fontWeight: "600" },
  addClassBtn: { alignSelf: "flex-start", marginBottom: spacing(3) },
  addedBadge: {
    backgroundColor: colors.successContainer,
    borderRadius: radius.full,
    paddingVertical: 2,
    paddingHorizontal: 8
  },
  addedBadgeText: { fontSize: 10, fontWeight: "600", color: colors.success },
  removeBtn: { paddingHorizontal: 8 },
  confirmCard: {
    backgroundColor: colors.errorContainer,
    borderRadius: radius.md,
    padding: spacing(4),
    marginTop: spacing(2)
  },
  confirmText: { ...typo.body, color: colors.onSurface, marginBottom: spacing(3) },
  confirmButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing(2) },
  removedLabel: { ...typo.label, textTransform: "uppercase", letterSpacing: 0.5, marginTop: spacing(3), marginBottom: spacing(2) },
  removedCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.neutralContainer,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(2)
  },
  removedTitle: { ...typo.body, fontWeight: "600" },
  removedTime: { fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 }
})
