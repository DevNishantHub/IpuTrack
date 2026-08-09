// src/components/TimetableGrid.tsx
// Renders one day at a time behind a row of day tabs (Mon | Tue | ... ),
// instead of a single wide grid with all days as columns. The old
// all-days-as-columns grid had to be horizontally scrolled on narrower
// phone screens, which was a poor experience - this avoids that entirely
// since only one day's schedule is on screen at once.
import { useMemo, useState } from "react"
import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native"
import { Lecture, Break } from "../types"
import { colors, radius, spacing } from "../theme"
import { DAY_NAMES, toMinutes, getToday } from "../utils/dateHelpers"

// Sunday is never used on this timetable, so only Mon-Sat render as tabs.
const VISIBLE_DAYS = DAY_NAMES.map((_, i) => i).slice(1)

type Props = {
  lectures: Lecture[]
  breaks: Break[]
  // Omit onEdit/onDelete entirely to render a read-only view, e.g. for the
  // locked master timetable view.
  onEdit?: (lecture: Lecture) => void
  onDelete?: (id: string) => void
  onEmptyCellPress?: (day: number, startTime: string) => void
}

type AgendaRow = { time: string; lecture?: Lecture; isBreak?: boolean }

export default function TimetableGrid({ lectures, breaks, onEdit, onDelete, onEmptyCellPress }: Props) {
  const readOnly = !onEdit && !onDelete

  // Default to today if it's a visible weekday, otherwise the first tab (Mon).
  const today = getToday()
  const initialDay = VISIBLE_DAYS.includes(today) ? today : VISIBLE_DAYS[0]
  const [selectedDay, setSelectedDay] = useState(initialDay)

  const rows: AgendaRow[] = useMemo(() => {
    const dayLectures = lectures.filter(l => l.day === selectedDay)
    const dayBreaks = breaks.filter(b => b.day === selectedDay)
    const merged: AgendaRow[] = [
      ...dayLectures.map(l => ({ time: l.startTime, lecture: l })),
      ...dayBreaks
        .filter(b => !dayLectures.some(l => l.startTime === b.startTime))
        .map(b => ({ time: b.startTime, isBreak: true }))
    ]
    return merged.sort((a, b) => toMinutes(a.time) - toMinutes(b.time))
  }, [lectures, breaks, selectedDay])

  const confirmDelete = (lecture: Lecture) => {
    if (!onDelete) return
    Alert.alert(
      "Remove lecture?",
      `${lecture.subject} on ${DAY_NAMES[lecture.day]} at ${lecture.startTime}`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => onDelete(lecture.id) }
      ]
    )
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.tabRow}>
        {VISIBLE_DAYS.map(day => {
          const active = day === selectedDay
          return (
            <TouchableOpacity
              key={day}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setSelectedDay(day)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{DAY_NAMES[day]}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <View style={styles.agenda}>
        {rows.length === 0 && <Text style={styles.empty}>No lectures on {DAY_NAMES[selectedDay]}.</Text>}

        {rows.map(row => {
          if (row.isBreak) {
            return (
              <View key={row.time} style={styles.row}>
                <View style={styles.timeCol}>
                  <Text style={styles.timeText}>{row.time}</Text>
                </View>
                <View style={[styles.card, styles.breakCard]}>
                  <Text style={styles.breakText}>BREAK</Text>
                </View>
              </View>
            )
          }

          const lecture = row.lecture!
          return (
            <View key={row.time} style={styles.row}>
              <View style={styles.timeCol}>
                <Text style={styles.timeText}>{lecture.startTime}</Text>
              </View>
              <TouchableOpacity
                style={[styles.card, styles.dataCard]}
                disabled={readOnly}
                onLongPress={onDelete ? () => confirmDelete(lecture) : undefined}
                onPress={onEdit ? () => onEdit(lecture) : undefined}
              >
                <Text style={styles.subjectText} numberOfLines={2}>
                  {lecture.subject}
                </Text>
                {lecture.note && (
                  <Text style={styles.noteText} numberOfLines={1}>
                    {lecture.note}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )
        })}

        {!readOnly && onEmptyCellPress && (
          <TouchableOpacity
            style={styles.addRow}
            onPress={() => onEmptyCellPress(selectedDay, rows.length ? rows[rows.length - 1].time : "09:00")}
          >
            <Text style={styles.addRowText}>+ Add to {DAY_NAMES[selectedDay]}</Text>
          </TouchableOpacity>
        )}
      </View>

      {!readOnly && <Text style={styles.hint}>Tap a lecture to edit · long-press to remove</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.divider
  },
  tabRow: {
    flexDirection: "row",
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider
  },
  tab: {
    flex: 1,
    paddingVertical: spacing(3),
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent"
  },
  tabActive: {
    backgroundColor: colors.primaryContainer,
    borderBottomColor: colors.primary
  },
  tabText: { fontSize: 13, fontWeight: "600", color: colors.onSurfaceVariant },
  tabTextActive: { color: colors.primaryDark },
  agenda: { padding: spacing(3) },
  row: { flexDirection: "row", alignItems: "stretch", marginBottom: spacing(2) },
  timeCol: { width: 56, justifyContent: "center", alignItems: "flex-start" },
  timeText: { fontSize: 12, color: colors.onSurfaceVariant },
  card: {
    flex: 1,
    borderRadius: radius.sm,
    padding: spacing(3),
    justifyContent: "center"
  },
  dataCard: { backgroundColor: colors.primaryContainer },
  subjectText: { fontSize: 14, fontWeight: "600", color: colors.primaryDark },
  noteText: { fontSize: 11, color: colors.onSurfaceVariant, marginTop: 2 },
  breakCard: { backgroundColor: colors.neutralContainer, alignItems: "center" },
  breakText: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceVariant },
  empty: { color: colors.onSurfaceVariant, paddingVertical: spacing(4), textAlign: "center" },
  addRow: {
    borderWidth: 1,
    borderColor: colors.outline,
    borderStyle: "dashed",
    borderRadius: radius.sm,
    padding: spacing(3),
    alignItems: "center",
    marginTop: spacing(1)
  },
  addRowText: { color: colors.primary, fontWeight: "600", fontSize: 13 },
  hint: { color: colors.onSurfaceVariant, fontSize: 11, padding: spacing(2) }
})
