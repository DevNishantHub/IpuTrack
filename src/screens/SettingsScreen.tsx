// src/screens/SettingsScreen.tsx
import { useEffect, useState } from "react"
import { View, Text, TextInput, StyleSheet, ScrollView, Alert } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Clipboard from "expo-clipboard"
import { MaterialIcons } from "@expo/vector-icons"
import MdButton from "../components/MdButton"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import { isTimetableImported, setMasterTimetable, getAttendanceThreshold, setAttendanceThreshold, DEFAULT_ATTENDANCE_THRESHOLD } from "../storage/storage"
import { TIMETABLE_IMPORT_PROMPT, validateImportedTimetable } from "../utils/timetableImport"

export default function SettingsScreen() {
  const [imported, setImported] = useState(false)
  const [showImportFlow, setShowImportFlow] = useState(false)
  const [pastedJson, setPastedJson] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_ATTENDANCE_THRESHOLD)
  const [thresholdInput, setThresholdInput] = useState("")

  useEffect(() => {
    isTimetableImported().then(setImported).catch(err => {
      console.warn("Failed to load timetable import status:", err)
    })
    getAttendanceThreshold()
      .then(t => { setThreshold(t); setThresholdInput(String(t)) })
      .catch(err => {
        console.warn("Failed to load attendance threshold, using default:", err)
        setThreshold(DEFAULT_ATTENDANCE_THRESHOLD)
        setThresholdInput(String(DEFAULT_ATTENDANCE_THRESHOLD))
      })
  }, [])

  const copyPrompt = async () => {
    await Clipboard.setStringAsync(TIMETABLE_IMPORT_PROMPT)
    Alert.alert("Copied", "Prompt copied. Paste it into ChatGPT (or similar) along with a photo of your timetable.")
  }

  const submitJson = () => {
    const result = validateImportedTimetable(pastedJson)
    if (!result.ok) {
      setError(result.error)
      return
    }
    const proceed = async () => {
      await setMasterTimetable(result.lectures)
      setImported(true)
      setShowImportFlow(false)
      setPastedJson("")
      setError(null)
      Alert.alert("Timetable saved", "Your timetable is now set as your permanent schedule.")
    }

    if (imported) {
      Alert.alert(
        "Replace your timetable?",
        "This replaces your entire permanent timetable. This can't be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", style: "destructive", onPress: proceed }
        ]
      )
    } else {
      proceed()
    }
  }

  const saveThreshold = async () => {
    // parseFloat (not parseInt) so a value like "75.5" is honored instead of
    // silently truncated to 75 with no feedback to the user.
    const value = parseFloat(thresholdInput)
    if (isNaN(value) || value < 1 || value > 100) {
      Alert.alert("Invalid threshold", "Please enter a number between 1 and 100.")
      return
    }
    try {
      // Awaited so the app doesn't show "Saved" (and the user doesn't close
      // the app) before the write has actually landed in storage.
      await setAttendanceThreshold(value)
      setThreshold(value)
      setThresholdInput(String(value))
      Alert.alert("Saved", `Low attendance threshold set to ${value}%`)
    } catch (err) {
      console.warn("Failed to save attendance threshold:", err)
      Alert.alert("Couldn't save", "Something went wrong saving your threshold. Please try again.")
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>TIMETABLE</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons
              name={imported ? "lock" : "info-outline"}
              size={20}
              color={colors.onSurfaceVariant}
            />
            <Text style={styles.cardTitle}>
              {imported ? "Your timetable is set" : "No timetable set yet"}
            </Text>
          </View>
          <Text style={styles.cardBody}>
            {imported
              ? "Your permanent timetable is locked in. It only changes if you import a new one here - there's no direct editing, to keep it from getting messed up by accident. Need a change for just one day? Use the edit option on that lecture in the Today tab instead."
              : "Set up your timetable once using a photo and an AI of your choice. It'll then be saved as your permanent schedule."}
          </Text>

          {!showImportFlow && (
            <MdButton
              title={imported ? "Import a new timetable" : "Set up my timetable"}
              variant={imported ? "outlined" : "filled"}
              onPress={() => setShowImportFlow(true)}
              style={styles.actionBtn}
            />
          )}
        </View>

        {showImportFlow && (
          <>
            <View style={styles.card}>
              <Text style={styles.stepLabel}>Step 1</Text>
              <Text style={styles.cardBody}>
                Copy this prompt, then paste it into ChatGPT (or Gemini, etc.) along with a
                photo of your timetable.
              </Text>
              <MdButton title="Copy prompt" variant="tonal" onPress={copyPrompt} style={styles.actionBtn} />
            </View>

            <View style={styles.card}>
              <Text style={styles.stepLabel}>Step 2</Text>
              <Text style={styles.cardBody}>
                Paste the AI's reply below, exactly as it came out.
              </Text>
              <TextInput
                style={styles.jsonInput}
                value={pastedJson}
                onChangeText={t => {
                  setPastedJson(t)
                  setError(null)
                }}
                placeholder='[{"subject": "AI", "day": 1, "startTime": "8:30", "note": "512"}, ...]'
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                textAlignVertical="top"
              />
              {error && (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={16} color={colors.error} />
                  <Text style={styles.errorText}>
                    {error} If this keeps happening, paste this exact message back into the
                    AI you're using and ask it to fix the JSON, then try again.
                  </Text>
                </View>
              )}
              <View style={styles.row}>
                <MdButton
                  title="Cancel"
                  variant="text"
                  onPress={() => {
                    setShowImportFlow(false)
                    setPastedJson("")
                    setError(null)
                  }}
                />
                <MdButton title="Save as my timetable" variant="filled" onPress={submitJson} />
              </View>
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="notifications-active" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>Low attendance alerts</Text>
          </View>
          <Text style={styles.cardBody}>
            Get a push notification when a subject's attendance drops below your threshold.
            Threshold applies per subject. Reset automatically when attendance recovers.
          </Text>
          <Text style={styles.label}>Threshold (%)</Text>
          <TextInput
            style={styles.input}
            value={thresholdInput}
            onChangeText={t => setThresholdInput(t)}
            placeholder={`Default: ${DEFAULT_ATTENDANCE_THRESHOLD}`}
            keyboardType="decimal-pad"
          />
          <MdButton title="Save threshold" variant="filled" onPress={saveThreshold} style={styles.actionBtn} />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing(4) },
  sectionLabel: {
    ...typo.label,
    marginBottom: spacing(2),
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing(4),
    marginBottom: spacing(3),
    ...elevation[1]
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing(2), marginBottom: spacing(2) },
  cardTitle: { ...typo.title },
  cardBody: { ...typo.body, color: colors.onSurfaceVariant, lineHeight: 20 },
  stepLabel: { ...typo.label, color: colors.primary, marginBottom: spacing(2) },
  actionBtn: { marginTop: spacing(3), alignSelf: "flex-start" },
  jsonInput: {
    marginTop: spacing(3),
    borderWidth: 1,
    borderColor: colors.outline,
    borderRadius: radius.md,
    padding: spacing(3),
    minHeight: 120,
    fontSize: 13,
    color: colors.onSurface,
    fontFamily: "monospace"
  },
  errorBox: {
    flexDirection: "row",
    gap: spacing(2),
    backgroundColor: colors.errorContainer,
    borderRadius: radius.md,
    padding: spacing(3),
    marginTop: spacing(3)
  },
  errorText: { flex: 1, fontSize: 13, color: colors.error, lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: spacing(2), marginTop: spacing(3) },
  label: { ...typo.label, marginTop: spacing(3), marginBottom: spacing(1) },
  input: {
    borderWidth: 1,
    borderColor: colors.outline,
    padding: spacing(2.5),
    borderRadius: radius.sm,
    color: colors.onSurface
  }
})
