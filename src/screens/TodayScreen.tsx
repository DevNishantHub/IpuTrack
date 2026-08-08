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
  pruneExpiredOverrides
} from "../storage/storage"
import { Lecture, Attendance, AttendanceStatus, DayOverride } from "../types"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import MdButton from "../components/MdButton"
import { toMinutes, getToday, getTodayDate } from "../utils/dateHelpers"
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
  const [displayLectures, setDisplayLectures] = useState<DisplayLecture[]>([])
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([])
  const [editing, setEditing] = useState<DisplayLecture | null>(null)
  const [editSubject, setEditSubject] = useState("")
  const [editTime, setEditTime] = useState("")
  const [editNote, setEditNote] = useState("")

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const todayDate = getTodayDate()
    await pruneExpiredOverrides(todayDate)

    const [allLectures, allAttendance, overrides] = await Promise.all([
      getLectures(),
      getAttendance(),
      getOverridesForDate(todayDate)
    ])

    const overrideFor = (id: string) => overrides.find(o => o.lectureId === id)

    const merged: DisplayLecture[] = allLectures
      .filter((l: Lecture) => l.day === getToday())
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
    setTodayAttendance(allAttendance.filter((a: Attendance) => a.date === todayDate))
  }

  const mark = async (lectureId: string, status: AttendanceStatus) => {
    // Always keyed by the master lectureId + today's date, so attendance
    // stays consistent even if today's override later changes or expires.
    await saveAttendance({
      id: Date.now().toString(),
      lectureId,
      date: getTodayDate(),
      status
    })
    await load()
  }

  const statusFor = (lectureId: string) =>
    todayAttendance.find(a => a.lectureId === lectureId)?.status

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
      id: `${editing.id}-${getTodayDate()}`,
      date: getTodayDate(),
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
      id: `${editing.id}-${getTodayDate()}`,
      date: getTodayDate(),
      lectureId: editing.id,
      cancelled: true
    })
    setEditing(null)
    await load()
  }

  const revertToday = async () => {
    if (!editing) return
    await clearOverride(editing.id, getTodayDate())
    setEditing(null)
    await load()
  }

  const todayName = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.dateLabel}>{todayName}</Text>

        {displayLectures.length === 0 && (
          <View style={styles.emptyCard}>
            <MaterialIcons name="event-available" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.empty}>No lectures scheduled for today.</Text>
          </View>
        )}

        {displayLectures.map(l => {
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
  dateLabel: { ...typo.label, marginBottom: spacing(3), textTransform: "uppercase", letterSpacing: 0.5 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(8),
    alignItems: "center",
    gap: spacing(2)
  },
  empty: { ...typo.body, color: colors.onSurfaceVariant, textAlign: "center" },
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
