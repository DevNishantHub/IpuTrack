// src/screens/TimetableScreen.tsx
import { useEffect, useState } from "react"
import { View, Text, TextInput, StyleSheet, Alert, ScrollView, TouchableOpacity } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { getLectures, saveLectures, getBreaks } from "../storage/storage"
import { Lecture, Break } from "../types"
import { CLASS_SUBJECTS, LAB_SUBJECTS } from "../data/subjects"
import TimetableGrid from "../components/TimetableGrid"
import MdButton from "../components/MdButton"
import { colors, elevation, radius, type as typo, spacing } from "../theme"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + (m || 0)
}

type SubjectType = "class" | "lab"

export default function TimetableScreen() {
  const [lectures, setLectures] = useState<Lecture[]>([])
  const [breaks, setBreaks] = useState<Break[]>([])

  const [subjectType, setSubjectType] = useState<SubjectType>("class")
  const [subject, setSubject] = useState<string | null>(null)
  const [day, setDay] = useState(1)
  const [time, setTime] = useState("10:00")
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const [lectureData, breakData] = await Promise.all([getLectures(), getBreaks()])
    setLectures(lectureData)
    setBreaks(breakData)
  }

  const resetForm = () => {
    setSubject(null)
    setSubjectType("class")
    setDay(1)
    setTime("10:00")
    setEditingId(null)
  }

  const startEdit = (lecture: Lecture) => {
    setEditingId(lecture.id)
    setSubject(lecture.subject)
    setSubjectType(LAB_SUBJECTS.includes(lecture.subject) ? "lab" : "class")
    setDay(lecture.day)
    setTime(lecture.startTime)
  }

  const saveLecture = async () => {
    if (!subject) {
      Alert.alert("Pick a subject", "Choose a subject from the list above.")
      return
    }
    if (!/^\d{1,2}:\d{2}$/.test(time.trim())) {
      Alert.alert("Invalid time", "Time must be in HH:MM format, e.g. 10:00.")
      return
    }

    const trimmedTime = time.trim()

    const clash = lectures.find(
      l => l.day === day && l.startTime === trimmedTime && l.id !== editingId
    )
    if (clash) {
      Alert.alert(
        "Slot already taken",
        `${clash.subject} is already scheduled on ${DAY_NAMES[day]} at ${trimmedTime}.`
      )
      return
    }

    const onBreak = breaks.some(b => b.day === day && b.startTime === trimmedTime)
    if (onBreak) {
      Alert.alert(
        "That's a break slot",
        `${DAY_NAMES[day]} at ${trimmedTime} is marked as a break. Pick a different time.`
      )
      return
    }

    let updated: Lecture[]
    if (editingId) {
      updated = lectures.map(l =>
        l.id === editingId
          ? { ...l, subject, day, startTime: trimmedTime, endTime: trimmedTime }
          : l
      )
    } else {
      const newLecture: Lecture = {
        id: Date.now().toString(),
        subject,
        day,
        startTime: trimmedTime,
        endTime: trimmedTime
      }
      updated = [...lectures, newLecture]
    }

    setLectures(updated)
    await saveLectures(updated)
    resetForm()
  }

  const removeLecture = async (id: string) => {
    const updated = lectures.filter(l => l.id !== id)
    setLectures(updated)
    await saveLectures(updated)
    if (editingId === id) resetForm()
  }

  const subjectOptions = subjectType === "class" ? CLASS_SUBJECTS : LAB_SUBJECTS

  const sortedLectures = [...lectures].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day
    return toMinutes(a.startTime) - toMinutes(b.startTime)
  })

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.formCard}>
          <Text style={styles.heading}>{editingId ? "Edit Lecture" : "Add Lecture"}</Text>

          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggleBtn, subjectType === "class" && styles.toggleBtnActive]}
              onPress={() => { setSubjectType("class"); setSubject(null) }}
            >
              <Text style={subjectType === "class" ? styles.toggleTextActive : styles.toggleText}>
                Class
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, subjectType === "lab" && styles.toggleBtnActive]}
              onPress={() => { setSubjectType("lab"); setSubject(null) }}
            >
              <Text style={subjectType === "lab" ? styles.toggleTextActive : styles.toggleText}>
                Lab
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {subjectOptions.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, subject === s && styles.chipActive]}
                onPress={() => setSubject(s)}
              >
                <Text style={subject === s ? styles.chipTextActive : styles.chipText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {DAY_NAMES.map((name, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.chip, day === idx && styles.chipActive]}
                onPress={() => setDay(idx)}
              >
                <Text style={day === idx ? styles.chipTextActive : styles.chipText}>{name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Time (HH:MM)</Text>
          <TextInput
            placeholder="10:00"
            value={time}
            onChangeText={setTime}
            style={styles.input}
            placeholderTextColor={colors.onSurfaceVariant}
          />

          <View style={styles.formButtons}>
            <MdButton title={editingId ? "Update" : "Add"} onPress={saveLecture} />
            {editingId && <MdButton title="Cancel" variant="text" onPress={resetForm} />}
          </View>
        </View>

        <Text style={styles.sectionLabel}>YOUR TIMETABLE</Text>

        <TimetableGrid
          lectures={sortedLectures}
          breaks={breaks}
          onEdit={startEdit}
          onDelete={removeLecture}
          onEmptyCellPress={(emptyDay, emptyTime) => {
            setEditingId(null)
            setDay(emptyDay)
            setTime(emptyTime)
          }}
        />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing(4) },
  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginBottom: spacing(5),
    ...elevation[1]
  },
  heading: { ...typo.title },
  sectionLabel: { ...typo.label, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: spacing(2) },
  label: { ...typo.label, marginTop: spacing(3), marginBottom: spacing(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing(2.5),
    borderRadius: radius.sm,
    color: colors.onSurface
  },
  toggleRow: { flexDirection: "row", gap: spacing(2), marginTop: spacing(3) },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.primary
  },
  toggleBtnActive: { backgroundColor: colors.primary },
  toggleText: { color: colors.primary, fontWeight: "600" },
  toggleTextActive: { color: colors.onPrimary, fontWeight: "600" },
  chipRow: { marginTop: spacing(2) },
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
  formButtons: { flexDirection: "row", gap: spacing(2), marginTop: spacing(4), alignItems: "center" }
})
