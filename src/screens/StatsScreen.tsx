// src/screens/StatsScreen.tsx
import { useCallback, useState } from "react"
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
import { getAttendance, getLectures, clearAllData, getAttendanceThreshold, getEffectiveThresholds, getSemesterStartDate, archiveCurrentSemester } from "../storage/storage"
import { calculateStats, calculateBunkInfo, getAttendanceTrend } from "../utils/attendance"
import { Attendance, Lecture } from "../types"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import MdButton from "../components/MdButton"
import AttendanceChart from "../components/AttendanceChart"
import { getTodayDate } from "../utils/dateHelpers"

type SubjectStats = {
  subject: string
  present: number
  absent: number
  cancelled: number
  percentage: number
  canSkip: number
  mustAttend: number
  threshold: number
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
  const [threshold, setThreshold] = useState(75)
  const [semesterStartDate, setSemesterStartDate] = useState<string>("")
  const [selectedTrendSubject, setSelectedTrendSubject] = useState<string | null>(null)
  const [trendData, setTrendData] = useState<{ date: string; percentage: number }[]>([])
  const [confirmingArchive, setConfirmingArchive] = useState(false)

  useFocusEffect(
    useCallback(() => {
      load()
    }, [])
  )

  const load = async () => {
    const [attendance, lectures, globalThreshold, semStart]: [
      Attendance[],
      Lecture[],
      number,
      string | null
    ] = await Promise.all([
      getAttendance(),
      getLectures(),
      getAttendanceThreshold(),
      getSemesterStartDate()
    ])

    setThreshold(globalThreshold)
    setSemesterStartDate(semStart ?? getTodayDate())

    // Filter attendance by semester start date for current stats
    const currentAttendance = attendance.filter(a => a.date >= (semStart ?? getTodayDate()))

    setOverall(calculateStats(currentAttendance))

    const subjects = Array.from(new Set(lectures.map(l => l.subject))).sort()
    const effectiveThresholds = await getEffectiveThresholds(subjects)
    const perSubject = subjects.map(subject => {
      const lectureIds = lectures.filter(l => l.subject === subject).map(l => l.id)
      const subjectAttendance = currentAttendance.filter(a => lectureIds.includes(a.lectureId))
      const stats = calculateStats(subjectAttendance)
      const effectiveThreshold = effectiveThresholds[subject]
      const bunk = calculateBunkInfo(currentAttendance, lectures, subject, effectiveThreshold)
      return { subject, ...stats, ...bunk, threshold: effectiveThreshold }
    })
    setBySubject(perSubject)
  }

  const handleReset = async () => {
    await clearAllData()
    setConfirmingReset(false)
    load()
  }

  const handleArchive = async () => {
    await archiveCurrentSemester()
    setConfirmingArchive(false)
    load()
  }

  const ringColor = barColor(overall.percentage)

  const getTrendData = async (subject: string) => {
    const [attendance, lectures, semStart] = await Promise.all([
      getAttendance(),
      getLectures(),
      getSemesterStartDate()
    ])
    return getAttendanceTrend(attendance, lectures, subject, semStart ?? getTodayDate())
  }

  const handleTrendPress = async (subject: string) => {
    if (selectedTrendSubject === subject) {
      setSelectedTrendSubject(null)
      setTrendData([])
      return
    }
    setSelectedTrendSubject(subject)
    const data = await getTrendData(subject)
    setTrendData(data)
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
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

        <View style={styles.semesterCard}>
          <View style={styles.semesterRow}>
            <View>
              <Text style={styles.semesterLabel}>Current Semester</Text>
              <Text style={styles.semesterDate}>{semesterStartDate}</Text>
            </View>
            <MdButton title="Archive & Start New" variant="outlined" onPress={() => setConfirmingArchive(true)} style={styles.semesterBtn} />
          </View>
          {confirmingArchive && (
            <View style={styles.confirmCard}>
              <Text style={styles.confirmText}>
                This archives your current attendance and starts a fresh semester. Your timetable stays intact.
              </Text>
              <View style={styles.confirmButtons}>
                <MdButton title="Cancel" variant="text" onPress={() => setConfirmingArchive(false)} />
                <MdButton title="Archive" variant="danger" onPress={handleArchive} />
              </View>
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>BY SUBJECT</Text>

        {selectedTrendSubject && trendData.length > 0 && (
          <View style={styles.trendCard}>
            <AttendanceChart
              subject={selectedTrendSubject}
              threshold={bySubject.find(s => s.subject === selectedTrendSubject)?.threshold ?? threshold}
              data={trendData}
            />
          </View>
        )}

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

            <View style={styles.bunkRow}>
              {s.canSkip > 0 && (
                <View style={styles.bunkItem}>
                  <Text style={styles.bunkLabel}>Can skip</Text>
                  <Text style={[styles.bunkValue, { color: colors.success }]}>{s.canSkip} more</Text>
                </View>
              )}
              {s.mustAttend > 0 && (
                <View style={styles.bunkItem}>
                  <Text style={styles.bunkLabel}>Must attend</Text>
                  <Text style={[styles.bunkValue, { color: colors.error }]}>{s.mustAttend} next</Text>
                </View>
              )}
              {s.canSkip === 0 && s.mustAttend === 0 && s.present + s.absent > 0 && (
                <Text style={styles.bunkNeutral}>On track</Text>
              )}
            </View>

            <View style={styles.thresholdRow}>
              <Text style={styles.thresholdLabel}>Threshold: {s.threshold}%</Text>
              <MdButton
                title={selectedTrendSubject === s.subject ? "Hide trend" : "Show trend"}
                variant="text"
                onPress={() => handleTrendPress(s.subject)}
                style={styles.trendBtn}
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
  semesterCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(5),
    ...elevation[1]
  },
  semesterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  semesterLabel: { fontSize: 11, color: colors.onSurfaceVariant },
  semesterDate: { ...typo.title, fontSize: 14, marginTop: 2 },
  semesterBtn: { alignSelf: "center" },
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
  bunkRow: { flexDirection: "row", alignItems: "center", marginTop: spacing(3), gap: spacing(4) },
  bunkItem: { flexDirection: "column" },
  bunkLabel: { fontSize: 11, color: colors.onSurfaceVariant },
  bunkValue: { fontSize: 13, fontWeight: "700" },
  bunkNeutral: { fontSize: 12, color: colors.onSurfaceVariant },
  thresholdRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing(3)
  },
  thresholdLabel: { fontSize: 12, color: colors.onSurfaceVariant },
  trendBtn: { paddingHorizontal: 0 },
  trendCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(2),
    ...elevation[1]
  },
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
