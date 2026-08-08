// src/screens/StatsScreen.tsx
import { useCallback, useState } from "react"
import { View, Text, StyleSheet, ScrollView } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
import { getAttendance, getLectures, clearAllData } from "../storage/storage"
import { calculateStats } from "../utils/attendance"
import { Attendance, Lecture } from "../types"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import MdButton from "../components/MdButton"

type SubjectStats = {
  subject: string
  present: number
  absent: number
  cancelled: number
  percentage: number
}

const barColor = (pct: number) =>
  pct >= 75 ? colors.success : pct >= 50 ? "#f9ab00" : colors.error

export default function StatsScreen() {
  const [overall, setOverall] = useState({
    present: 0,
    absent: 0,
    cancelled: 0,
    percentage: 0
  })
  const [bySubject, setBySubject] = useState<SubjectStats[]>([])
  const [confirmingReset, setConfirmingReset] = useState(false)

  useFocusEffect(
    useCallback(() => {
      load()
    }, [])
  )

  const load = async () => {
    const [attendance, lectures]: [Attendance[], Lecture[]] = await Promise.all([
      getAttendance(),
      getLectures()
    ])

    setOverall(calculateStats(attendance))

    const subjects = Array.from(new Set(lectures.map(l => l.subject))).sort()
    const perSubject = subjects.map(subject => {
      const lectureIds = lectures.filter(l => l.subject === subject).map(l => l.id)
      const subjectAttendance = attendance.filter(a => lectureIds.includes(a.lectureId))
      const stats = calculateStats(subjectAttendance)
      return { subject, ...stats }
    })
    setBySubject(perSubject)
  }

  const handleReset = async () => {
    await clearAllData()
    setConfirmingReset(false)
    load()
  }

  const ringColor = barColor(overall.percentage)

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroCard}>
          <View style={[styles.ring, { borderColor: ringColor }]}>
            <Text style={[styles.ringText, { color: ringColor }]}>
              {overall.percentage.toFixed(0)}%
            </Text>
          </View>
          <View style={{ flex: 1, marginLeft: spacing(4) }}>
            <Text style={styles.heroTitle}>Overall Attendance</Text>
            <Text style={styles.heroSub}>
              {overall.present} present · {overall.absent} absent
            </Text>
            <Text style={styles.heroSubMuted}>{overall.cancelled} cancelled (not counted)</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>BY SUBJECT</Text>

        {bySubject.length === 0 && (
          <Text style={styles.empty}>No lectures added yet.</Text>
        )}

        {bySubject.map(s => (
          <View key={s.subject} style={styles.subjectCard}>
            <View style={styles.subjectRow}>
              <Text style={styles.subjectName}>{s.subject}</Text>
              <Text style={[styles.subjectPct, { color: barColor(s.percentage) }]}>
                {s.percentage.toFixed(1)}%
              </Text>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.min(s.percentage, 100)}%`, backgroundColor: barColor(s.percentage) }
                ]}
              />
            </View>
          </View>
        ))}

        <View style={styles.resetWrap}>
          {confirmingReset ? (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmText}>
                This clears your timetable and attendance history. This can't be undone.
              </Text>
              <View style={styles.confirmButtons}>
                <MdButton title="Cancel" variant="text" onPress={() => setConfirmingReset(false)} />
                <MdButton title="Reset" variant="danger" onPress={handleReset} />
              </View>
            </View>
          ) : (
            <MdButton title="Reset All Data" variant="text" onPress={() => setConfirmingReset(true)} />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing(4) },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(5),
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing(5),
    ...elevation[1]
  },
  ring: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 5,
    alignItems: "center",
    justifyContent: "center"
  },
  ringText: { fontSize: 18, fontWeight: "700" },
  heroTitle: { ...typo.title },
  heroSub: { ...typo.body, color: colors.onSurfaceVariant, marginTop: 2 },
  heroSubMuted: { fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 },
  sectionLabel: { ...typo.label, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing(2) },
  empty: { ...typo.body, color: colors.onSurfaceVariant },
  subjectCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(2),
    ...elevation[1]
  },
  subjectRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing(2) },
  subjectName: { ...typo.title, fontSize: 14 },
  subjectPct: { fontSize: 14, fontWeight: "700" },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.neutralContainer, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  resetWrap: { marginTop: spacing(6), alignItems: "flex-start" },
  confirmCard: {
    backgroundColor: colors.errorContainer,
    borderRadius: radius.md,
    padding: spacing(4),
    width: "100%"
  },
  confirmText: { ...typo.body, color: colors.onSurface, marginBottom: spacing(3) },
  confirmButtons: { flexDirection: "row", justifyContent: "flex-end", gap: spacing(2) }
})
