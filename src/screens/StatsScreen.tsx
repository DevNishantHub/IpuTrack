// src/screens/StatsScreen.tsx
import { useCallback, useMemo, useState } from "react"
import { View, Text, StyleSheet, ScrollView, Alert } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "@react-navigation/native"
import { getAttendance, getLectures, getExtraLectures, clearAllData, getAttendanceThreshold, getEffectiveThresholds, getSemesterStartDate, archiveCurrentSemester } from "../storage/storage"
import { calculateStats, calculateBunkInfo, getAttendanceTrend } from "../utils/attendance"
import { normalizeSubject, subjectLabelsByKey } from "../utils/csv"
import { Attendance, Lecture, ExtraLecture } from "../types"
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

  // `load` is defined before useFocusEffect so the callback captures a
  // stable reference. useCallback with an empty dep array is correct here:
  // load reads all its data fresh from storage on every call and doesn't
  // close over any component state that could go stale.
  const load = useCallback(async () => {
    const [attendance, lectures, extras, globalThreshold, semStart]: [
      Attendance[],
      Lecture[],
      ExtraLecture[],
      number,
      string | null
    ] = await Promise.all([
      getAttendance(),
      getLectures(),
      getExtraLectures(),
      getAttendanceThreshold(),
      getSemesterStartDate()
    ])

    setThreshold(globalThreshold)
    setSemesterStartDate(semStart ?? getTodayDate())

    // Filter attendance by semester start date for current stats. When no
    // semester start has ever been set, include everything - otherwise
    // backfilled days before "today" would be silently hidden from stats.
    const currentAttendance = semStart
      ? attendance.filter(a => a.date >= semStart)
      : attendance

    setOverall(calculateStats(currentAttendance))

    // Subjects come from BOTH the master timetable and one-off extra
    // classes (added from the Today tab or created by CSV import) - a
    // subject that only exists as an extra is still a subject with
    // attendance history. Names that differ only by case / trailing
    // punctuation / a lab-room number ("AI Lab" vs the timetable's
    // "AI Lab 4") collapse onto ONE card, labeled with the master
    // timetable's spelling when one exists.
    const labelsByKey = subjectLabelsByKey(lectures, extras)
    const subjects = Array.from(labelsByKey.keys()).sort((a, b) =>
      labelsByKey.get(a)!.localeCompare(labelsByKey.get(b)!)
    )
    const effectiveThresholds = await getEffectiveThresholds(
      Array.from(labelsByKey.values())
    )
    const perSubject = subjects.map(key => {
      const displayName = labelsByKey.get(key)!
      // Resolve the subject's classes across both id spaces - master
      // timetable ids and one-off extra ids (e.g. "ai-2026-01-06-8-30") -
      // matched by normalized subject so variants count toward the same card.
      const lectureIds = lectures.filter(l => normalizeSubject(l.subject) === key).map(l => l.id)
      const extraIds = extras.filter(e => normalizeSubject(e.subject) === key).map(e => e.id)
      const subjectAttendance = currentAttendance.filter(
        a => lectureIds.includes(a.lectureId) || extraIds.includes(a.lectureId)
      )
      const stats = calculateStats(subjectAttendance)
      const effectiveThreshold = effectiveThresholds[displayName]
      // Bunk planning counts future classes by the master timetable's exact
      // spelling (the label above) - correct when the timetable uses one
      // spelling per subject, which is the normal case; variants only ever
      // come from one-off extras, whose ids are passed separately.
      const bunk = calculateBunkInfo(currentAttendance, lectures, displayName, effectiveThreshold, extraIds)
      return { subject: displayName, ...stats, ...bunk, threshold: effectiveThreshold }
    })
    setBySubject(perSubject)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load])
  )

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

  const ringColor = useMemo(() => barColor(overall.percentage), [overall.percentage])

  const getTrendData = useCallback(async (subject: string) => {
    const [attendance, lectures, extras, semStart] = await Promise.all([
      getAttendance(),
      getLectures(),
      getExtraLectures(),
      getSemesterStartDate()
    ])
    // Match extras by normalized subject too, so a variant name like
    // "AI Lab" feeds the "AI Lab 4" card's trend.
    const key = normalizeSubject(subject)
    const extraIds = extras.filter(e => normalizeSubject(e.subject) === key).map(e => e.id)
    // Empty semester start = include all attendance (same rule as load()).
    return getAttendanceTrend(attendance, lectures, subject, semStart ?? "", extraIds)
  }, [])

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
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No lectures yet</Text>
            <Text style={styles.emptyBody}>
              Set up your timetable in Settings to start tracking attendance per subject.
              Once you mark a class as present or absent on the Today tab, your stats will appear here.
            </Text>
          </View>
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
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(5),
    alignItems: "center" as const,
    gap: spacing(2),
    marginBottom: spacing(3),
  },
  emptyTitle: { ...typo.title, textAlign: "center" as const },
  emptyBody: { ...typo.body, color: colors.onSurfaceVariant, textAlign: "center" as const, lineHeight: 20 },
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
