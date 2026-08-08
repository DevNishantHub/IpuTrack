// src/screens/TodayScreen.tsx
import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { MaterialIcons } from "@expo/vector-icons"
import { getLectures, getAttendance, saveAttendance } from "../storage/storage"
import { Lecture, Attendance, AttendanceStatus } from "../types"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import MdButton from "../components/MdButton"

const getToday = () => new Date().getDay()
const getTodayDate = () => new Date().toISOString().split("T")[0]

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + (m || 0)
}

const STATUS_META: Record<AttendanceStatus, { label: string; color: string; bg: string; icon: keyof typeof MaterialIcons.glyphMap }> = {
  present: { label: "Present", color: colors.success, bg: colors.successContainer, icon: "check-circle" },
  absent: { label: "Absent", color: colors.error, bg: colors.errorContainer, icon: "cancel" },
  cancelled: { label: "Cancelled", color: colors.onSurfaceVariant, bg: colors.neutralContainer, icon: "block" }
}

export default function TodayScreen() {
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [todayAttendance, setTodayAttendance] = useState<Attendance[]>([])

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const [allLectures, allAttendance] = await Promise.all([
      getLectures(),
      getAttendance()
    ])
    const todaysLectures = allLectures
      .filter((l: Lecture) => l.day === getToday())
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
    setLectures(todaysLectures)
    setTodayAttendance(
      allAttendance.filter((a: Attendance) => a.date === getTodayDate())
    )
  }

  const mark = async (lectureId: string, status: AttendanceStatus) => {
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

  const todayName = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.dateLabel}>{todayName}</Text>

        {lectures.length === 0 && (
          <View style={styles.emptyCard}>
            <MaterialIcons name="event-available" size={32} color={colors.onSurfaceVariant} />
            <Text style={styles.empty}>No lectures scheduled for today.</Text>
          </View>
        )}

        {lectures.map(l => {
          const current = statusFor(l.id)
          const meta = current ? STATUS_META[current] : null
          return (
            <View key={l.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={styles.title}>{l.subject}</Text>
                  <Text style={styles.time}>{l.startTime}</Text>
                </View>
                {meta && (
                  <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                    <MaterialIcons name={meta.icon} size={14} color={meta.color} />
                    <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                )}
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
  title: { ...typo.title },
  time: { ...typo.body, color: colors.onSurfaceVariant, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.full
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
  buttonRow: { flexDirection: "row", gap: spacing(2), flexWrap: "wrap" }
})
