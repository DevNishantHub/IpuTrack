// src/components/TimetableGrid.tsx
import { useMemo } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from "react-native"
import { Lecture, Break } from "../types"
import { colors, radius } from "../theme"
import { DAY_NAMES, toMinutes } from "../utils/dateHelpers"

// Sunday is never used on this timetable, so only Mon-Sat render as columns.
const VISIBLE_DAYS = DAY_NAMES.map((_, i) => i).slice(1)

const TIME_COL_WIDTH = 64
const DAY_COL_WIDTH = 104

type Props = {
  lectures: Lecture[]
  breaks: Break[]
  // Omit onEdit/onDelete entirely to render a read-only grid, e.g. for the
  // locked master timetable view.
  onEdit?: (lecture: Lecture) => void
  onDelete?: (id: string) => void
  onEmptyCellPress?: (day: number, startTime: string) => void
}

export default function TimetableGrid({ lectures, breaks, onEdit, onDelete, onEmptyCellPress }: Props) {
  const readOnly = !onEdit && !onDelete
  const rowTimes = useMemo(
    () =>
      Array.from(
        new Set([...lectures.map(l => l.startTime), ...breaks.map(b => b.startTime)])
      ).sort((a, b) => toMinutes(a) - toMinutes(b)),
    [lectures, breaks]
  )

  const findLecture = (day: number, time: string) =>
    lectures.find(l => l.day === day && l.startTime === time)

  const isBreak = (day: number, time: string) =>
    breaks.some(b => b.day === day && b.startTime === time)

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

  if (rowTimes.length === 0) {
    return <Text style={styles.empty}>No lectures added yet.</Text>
  }

  return (
    <View style={styles.wrapper}>
      <ScrollView horizontal showsHorizontalScrollIndicator={true}>
        <View>
          <View style={styles.row}>
            <View style={[styles.cell, styles.headerCell, { width: TIME_COL_WIDTH }]} />
            {VISIBLE_DAYS.map(day => (
              <View key={day} style={[styles.cell, styles.headerCell, { width: DAY_COL_WIDTH }]}>
                <Text style={styles.headerText}>{DAY_NAMES[day]}</Text>
              </View>
            ))}
          </View>

          {rowTimes.map(time => (
            <View key={time} style={styles.row}>
              <View style={[styles.cell, styles.timeCell, { width: TIME_COL_WIDTH }]}>
                <Text style={styles.timeText}>{time}</Text>
              </View>
              {VISIBLE_DAYS.map(day => {
                const lecture = findLecture(day, time)
                const onBreak = !lecture && isBreak(day, time)

                if (onBreak) {
                  return (
                    <View key={day} style={[styles.cell, styles.breakCell, { width: DAY_COL_WIDTH }]}>
                      <Text style={styles.breakText}>BREAK</Text>
                    </View>
                  )
                }

                return (
                  <TouchableOpacity
                    key={day}
                    style={[styles.cell, styles.dataCell, lecture && styles.dataCellFilled, { width: DAY_COL_WIDTH }]}
                    disabled={readOnly && !lecture}
                    onLongPress={lecture && onDelete ? () => confirmDelete(lecture) : undefined}
                    onPress={
                      lecture
                        ? (onEdit ? () => onEdit(lecture) : undefined)
                        : onEmptyCellPress
                          ? () => onEmptyCellPress(day, time)
                          : undefined
                    }
                  >
                    {lecture && (
                      <>
                        <Text style={styles.subjectText} numberOfLines={2}>
                          {lecture.subject}
                        </Text>
                        {lecture.note && (
                          <Text style={styles.noteText} numberOfLines={1}>
                            {lecture.note}
                          </Text>
                        )}
                      </>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}
        </View>
      </ScrollView>
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
  row: { flexDirection: "row" },
  cell: {
    borderWidth: 0.5,
    borderColor: colors.divider,
    justifyContent: "center",
    alignItems: "center",
    minHeight: 52,
    padding: 4
  },
  headerCell: { backgroundColor: colors.primaryContainer },
  headerText: { fontWeight: "700", fontSize: 13, color: colors.primaryDark },
  timeCell: { backgroundColor: colors.background },
  timeText: { fontSize: 11, color: colors.onSurfaceVariant },
  dataCell: { backgroundColor: colors.surface },
  dataCellFilled: { backgroundColor: colors.primaryContainer },
  subjectText: { fontSize: 13, fontWeight: "600", textAlign: "center", color: colors.primaryDark },
  noteText: { fontSize: 10, color: colors.onSurfaceVariant, textAlign: "center", marginTop: 2 },
  breakCell: { backgroundColor: colors.neutralContainer },
  breakText: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceVariant },
  empty: { color: colors.onSurfaceVariant, marginTop: 8 },
  hint: { color: colors.onSurfaceVariant, fontSize: 11, padding: 8 }
})
