// src/components/LectureCard.tsx
import { View, Text, StyleSheet, TouchableOpacity } from "react-native"
import { Lecture } from "../types"

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

type Props = {
  lecture: Lecture
  onDelete?: (id: string) => void
  onEdit?: (lecture: Lecture) => void
}

export default function LectureCard({ lecture, onDelete, onEdit }: Props) {
  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={{ flex: 1 }}
        onPress={onEdit ? () => onEdit(lecture) : undefined}
        disabled={!onEdit}
      >
        <Text style={styles.subject}>{lecture.subject}</Text>
        <Text style={styles.meta}>
          {DAY_NAMES[lecture.day]} · {lecture.startTime}
        </Text>
      </TouchableOpacity>
      <View style={styles.actions}>
        {onEdit && (
          <TouchableOpacity
            onPress={() => onEdit(lecture)}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        )}
        {onDelete && (
          <TouchableOpacity
            onPress={() => onDelete(lecture.id)}
            style={styles.actionBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteText}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginBottom: 8
  },
  subject: { fontSize: 16, fontWeight: "600" },
  meta: { color: "#555", marginTop: 2 },
  actions: { flexDirection: "row", gap: 12 },
  actionBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  editText: { color: "#2e86de", fontWeight: "600" },
  deleteText: { color: "#c62828", fontWeight: "600" }
})
