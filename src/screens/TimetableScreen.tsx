// src/screens/TimetableScreen.tsx
// Read-only view of the permanent/master timetable. There is deliberately no
// in-app editing here - the master timetable is only set/replaced via the
// AI-import flow in Settings. For a single-day change, see the Today tab.
import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { MaterialIcons } from "@expo/vector-icons"
import { getLectures, getBreaks, isTimetableImported } from "../storage/storage"
import { Lecture, Break } from "../types"
import TimetableGrid from "../components/TimetableGrid"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import { toMinutes } from "../utils/dateHelpers"

export default function TimetableScreen() {
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [breaks, setBreaks] = useState<Break[]>([])
  const [imported, setImported] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const [lectureData, breakData, importedFlag] = await Promise.all([
      getLectures(),
      getBreaks(),
      isTimetableImported()
    ])
    setLectures(lectureData)
    setBreaks(breakData)
    setImported(importedFlag)
  }

  const sortedLectures = [...lectures].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day
    return toMinutes(a.startTime) - toMinutes(b.startTime)
  })

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!imported && (
          <View style={styles.noticeCard}>
            <MaterialIcons name="info-outline" size={18} color={colors.onSurfaceVariant} />
            <Text style={styles.noticeText}>
              This is a placeholder schedule. Go to Settings to set up your real timetable.
            </Text>
          </View>
        )}

        <Text style={styles.sectionLabel}>YOUR TIMETABLE</Text>
        <TimetableGrid lectures={sortedLectures} breaks={breaks} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing(4) },
  sectionLabel: { ...typo.label, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing(2) },
  noticeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(2),
    backgroundColor: colors.primaryContainer,
    borderRadius: radius.md,
    padding: spacing(3),
    marginBottom: spacing(4)
  },
  noticeText: { flex: 1, ...typo.body, color: colors.onSurfaceVariant }
})
