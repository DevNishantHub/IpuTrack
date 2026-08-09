// src/screens/SettingsScreen.tsx
import { useEffect, useState } from "react"
import { View, Text, TextInput, StyleSheet, ScrollView, Alert, Switch } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Clipboard from "expo-clipboard"
import { MaterialIcons } from "@expo/vector-icons"
import MdButton from "../components/MdButton"
import { colors, elevation, radius, type as typo, spacing } from "../theme"
import {
  isTimetableImported,
  setMasterTimetable,
  getAttendanceThreshold,
  setAttendanceThreshold,
  DEFAULT_ATTENDANCE_THRESHOLD,
  getAttendance,
  getLectures,
  saveAttendanceBulk,
  getSemesterStartDate,
  setSemesterStartDate,
  archiveCurrentSemester,
  getHolidays,
  addHoliday,
  removeHoliday,
  getReminderSettings,
  setReminderSettings,
  DEFAULT_REMINDER_MINUTES_BEFORE
} from "../storage/storage"
import { Holiday } from "../types"
import { TIMETABLE_IMPORT_PROMPT, validateImportedTimetable } from "../utils/timetableImport"
import { attendanceToCsv, parseAttendanceCsv } from "../utils/csv"
import { getTodayDate, isValidDateString } from "../utils/dateHelpers"
import { ensureNotificationPermission, scheduleClassReminders, cancelAllClassReminders } from "../utils/notifications"

export default function SettingsScreen() {
  const [imported, setImported] = useState(false)
  const [showImportFlow, setShowImportFlow] = useState(false)
  const [pastedJson, setPastedJson] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(DEFAULT_ATTENDANCE_THRESHOLD)
  const [thresholdInput, setThresholdInput] = useState("")

  const [semesterStartDate, setSemesterStartDate] = useState<string>("")
  const [semesterDateInput, setSemesterDateInput] = useState("")

  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvInput, setCsvInput] = useState("")
  const [csvError, setCsvError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [holidayDateInput, setHolidayDateInput] = useState("")
  const [holidayLabelInput, setHolidayLabelInput] = useState("")
  const [addingHoliday, setAddingHoliday] = useState(false)

  const [remindersEnabled, setRemindersEnabled] = useState(false)
  const [reminderMinutesInput, setReminderMinutesInput] = useState(String(DEFAULT_REMINDER_MINUTES_BEFORE))
  const [savingReminderMinutes, setSavingReminderMinutes] = useState(false)
  const [reminderToggleBusy, setReminderToggleBusy] = useState(false)

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
    getSemesterStartDate().then(date => {
      if (date) {
        setSemesterStartDate(date)
        setSemesterDateInput(date)
      }
    }).catch(err => {
      console.warn("Failed to load semester start date:", err)
    })
    getHolidays().then(setHolidays).catch(err => {
      console.warn("Failed to load holidays:", err)
    })
    getReminderSettings()
      .then(s => {
        setRemindersEnabled(s.enabled)
        setReminderMinutesInput(String(s.minutesBefore))
      })
      .catch(err => {
        console.warn("Failed to load reminder settings:", err)
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

      // Reminders are scheduled against specific lecture ids/times, so a
      // full timetable replace must re-sync them - otherwise old reminders
      // for lectures that no longer exist (or now have different times)
      // would keep firing.
      if (remindersEnabled) {
        const minutes = parseInt(reminderMinutesInput, 10) || DEFAULT_REMINDER_MINUTES_BEFORE
        scheduleClassReminders(result.lectures, minutes).catch(err => {
          console.warn("Failed to re-sync class reminders after timetable import:", err)
        })
      }
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

  const handleArchiveSemester = async () => {
    setArchiving(true)
    try {
      await archiveCurrentSemester()
      const today = getTodayDate()
      setSemesterStartDate(today)
      setSemesterDateInput(today)
      Alert.alert("Semester Archived", "Current attendance archived. New semester started today.")
    } catch (err) {
      console.warn("Failed to archive semester:", err)
      Alert.alert("Couldn't archive", "Something went wrong. Please try again.")
    } finally {
      setArchiving(false)
    }
  }

  const handleSemesterDateChange = async () => {
    if (!semesterDateInput) return
    if (!isValidDateString(semesterDateInput)) {
      Alert.alert("Invalid date", "Please enter a valid date in YYYY-MM-DD format.")
      return
    }
    try {
      await setSemesterStartDate(semesterDateInput)
      setSemesterStartDate(semesterDateInput)
      Alert.alert("Saved", `Semester start date set to ${semesterDateInput}`)
    } catch (err) {
      console.warn("Failed to save semester start date:", err)
      Alert.alert("Couldn't save", "Something went wrong. Please try again.")
    }
  }

  const exportAttendanceCsv = async () => {
    setExporting(true)
    try {
      const [attendance, lectures] = await Promise.all([getAttendance(), getLectures()])
      if (attendance.length === 0) {
        Alert.alert("Nothing to export", "You don't have any attendance records yet.")
        return
      }
      const csv = attendanceToCsv(attendance, lectures)
      await Clipboard.setStringAsync(csv)
      Alert.alert(
        "Copied to clipboard",
        `${attendance.length} attendance records copied as CSV. Paste them into Sheets, Excel, Notes, or an email to save/edit them.`
      )
    } catch (err) {
      console.warn("Failed to export attendance CSV:", err)
      Alert.alert("Couldn't export", "Something went wrong preparing your CSV. Please try again.")
    } finally {
      setExporting(false)
    }
  }

  const importAttendanceCsv = async () => {
    const result = parseAttendanceCsv(csvInput)
    if (!result.ok) {
      setCsvError(result.error)
      return
    }
    setImporting(true)
    try {
      await saveAttendanceBulk(result.entries)
      setShowCsvImport(false)
      setCsvInput("")
      setCsvError(null)
      const skippedNote = result.skippedCount > 0 ? ` ${result.skippedCount} row(s) were skipped (bad date/status/id).` : ""
      Alert.alert("Import complete", `${result.entries.length} record(s) saved.${skippedNote}`)
    } catch (err) {
      console.warn("Failed to import attendance CSV:", err)
      Alert.alert("Couldn't import", "Something went wrong saving these records. Please try again.")
    } finally {
      setImporting(false)
    }
  }

  const handleAddHoliday = async () => {
    const date = holidayDateInput.trim()
    if (!isValidDateString(date)) {
      Alert.alert("Invalid date", "Please enter a valid date in YYYY-MM-DD format.")
      return
    }

    const proceed = async () => {
      setAddingHoliday(true)
      try {
        await addHoliday(date, holidayLabelInput)
        const updated = await getHolidays()
        setHolidays(updated)
        setHolidayDateInput("")
        setHolidayLabelInput("")
      } catch (err) {
        console.warn("Failed to add holiday:", err)
        Alert.alert("Couldn't save", "Something went wrong adding this holiday. Please try again.")
      } finally {
        setAddingHoliday(false)
      }
    }

    // Marking a date a holiday never deletes existing attendance for that
    // date - but if there IS existing attendance, the user should know
    // it'll simply be hidden from Today's marking view while the holiday
    // flag is on, not touched.
    try {
      const attendance = await getAttendance()
      const hasExisting = attendance.some(a => a.date === date)
      if (hasExisting) {
        Alert.alert(
          "Attendance already marked",
          `You already have attendance recorded on ${date}. Marking it a holiday won't delete that data - it'll just be hidden from the Today screen while this date is set as a holiday.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Mark as holiday", onPress: proceed }
          ]
        )
        return
      }
    } catch (err) {
      console.warn("Failed to check existing attendance before adding holiday:", err)
      // Fall through and let the user add it anyway rather than blocking
      // the whole feature on this best-effort check failing.
    }

    await proceed()
  }

  const handleRemoveHoliday = async (date: string) => {
    try {
      await removeHoliday(date)
      const updated = await getHolidays()
      setHolidays(updated)
    } catch (err) {
      console.warn("Failed to remove holiday:", err)
      Alert.alert("Couldn't remove", "Something went wrong removing this holiday. Please try again.")
    }
  }

  const handleToggleReminders = async (value: boolean) => {
    setReminderToggleBusy(true)
    try {
      if (value) {
        const granted = await ensureNotificationPermission()
        if (!granted) {
          Alert.alert(
            "Notifications disabled",
            "Class reminders need notification permission. Enable it for this app in your device settings, then try again."
          )
          return
        }
        const minutes = parseInt(reminderMinutesInput, 10)
        const validMinutes = Number.isFinite(minutes) && minutes >= 1 && minutes <= 180
          ? minutes
          : DEFAULT_REMINDER_MINUTES_BEFORE
        await setReminderSettings({ enabled: true, minutesBefore: validMinutes })
        setReminderMinutesInput(String(validMinutes))
        const lectures = await getLectures()
        await scheduleClassReminders(lectures, validMinutes)
      } else {
        await setReminderSettings({ enabled: false, minutesBefore: parseInt(reminderMinutesInput, 10) || DEFAULT_REMINDER_MINUTES_BEFORE })
        await cancelAllClassReminders()
      }
      setRemindersEnabled(value)
    } catch (err) {
      console.warn("Failed to update class reminder setting:", err)
      Alert.alert("Couldn't save", "Something went wrong updating class reminders. Please try again.")
    } finally {
      setReminderToggleBusy(false)
    }
  }

  const handleSaveReminderMinutes = async () => {
    const minutes = parseInt(reminderMinutesInput, 10)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
      Alert.alert("Invalid value", "Please enter a number of minutes between 1 and 180.")
      return
    }
    setSavingReminderMinutes(true)
    try {
      await setReminderSettings({ enabled: remindersEnabled, minutesBefore: minutes })
      setReminderMinutesInput(String(minutes))
      if (remindersEnabled) {
        const lectures = await getLectures()
        await scheduleClassReminders(lectures, minutes)
      }
      Alert.alert("Saved", `You'll be reminded ${minutes} minute(s) before each class.`)
    } catch (err) {
      console.warn("Failed to save reminder minutes:", err)
      Alert.alert("Couldn't save", "Something went wrong saving this. Please try again.")
    } finally {
      setSavingReminderMinutes(false)
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
            Get a push notification when a subject's attendance drops below this threshold.
            Applies to every subject. Reset automatically when attendance recovers.
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

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="alarm" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>Class reminders</Text>
          </View>
          <Text style={styles.cardBody}>
            Get a push notification before each class starts, based on your permanent
            timetable. One-off "edit for today" changes on the Today tab don't shift or skip
            that day's reminder.
          </Text>
          <View style={styles.switchRow}>
            <Text style={styles.body}>Remind me before each class</Text>
            <Switch
              value={remindersEnabled}
              onValueChange={handleToggleReminders}
              disabled={reminderToggleBusy}
              trackColor={{ true: colors.primary }}
            />
          </View>
          {remindersEnabled && (
            <>
              <Text style={styles.label}>Minutes before</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={reminderMinutesInput}
                  onChangeText={setReminderMinutesInput}
                  placeholder={String(DEFAULT_REMINDER_MINUTES_BEFORE)}
                  keyboardType="number-pad"
                />
                <MdButton
                  title={savingReminderMinutes ? "Saving..." : "Save"}
                  variant="tonal"
                  onPress={handleSaveReminderMinutes}
                  disabled={savingReminderMinutes}
                />
              </View>
            </>
          )}
        </View>

        <Text style={styles.sectionLabel}>HOLIDAYS</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="beach-access" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>College holidays &amp; no-class days</Text>
          </View>
          <Text style={styles.cardBody}>
            Mark a date as a holiday to hide it from attendance marking on the Today tab.
            This never edits or deletes any attendance you've already recorded - it's kept
            completely separate from your attendance history.
          </Text>

          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={holidayDateInput}
            onChangeText={setHolidayDateInput}
            placeholder={getTodayDate()}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
          />
          <Text style={styles.label}>Label (optional)</Text>
          <TextInput
            style={styles.input}
            value={holidayLabelInput}
            onChangeText={setHolidayLabelInput}
            placeholder="e.g. Diwali, Mid-sem break"
          />
          <MdButton
            title={addingHoliday ? "Adding..." : "Add holiday"}
            variant="filled"
            onPress={handleAddHoliday}
            disabled={addingHoliday}
            style={styles.actionBtn}
          />

          {holidays.length > 0 && (
            <View style={styles.holidayList}>
              {holidays.map(h => (
                <View key={h.date} style={styles.holidayRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.holidayRowDate}>{h.date}</Text>
                    {h.label && <Text style={styles.holidayRowLabel}>{h.label}</Text>}
                  </View>
                  <MdButton
                    title="Remove"
                    variant="text"
                    onPress={() => handleRemoveHoliday(h.date)}
                  />
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>SEMESTER</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="calendar-today" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>Semester management</Text>
          </View>
          <Text style={styles.cardBody}>
            Archive current attendance and start a fresh semester. Your timetable is preserved.
          </Text>
          <View style={styles.semesterRow}>
            <Text style={styles.semesterLabel}>Current semester started:</Text>
            <Text style={styles.semesterDate}>{semesterStartDate || "Not set"}</Text>
          </View>
          <View style={styles.semesterInputRow}>
            <TextInput
              style={styles.input}
              value={semesterDateInput}
              onChangeText={t => setSemesterDateInput(t)}
              placeholder={`${getTodayDate()} (YYYY-MM-DD)`}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            <MdButton
              title="Set date"
              variant="tonal"
              onPress={handleSemesterDateChange}
              style={styles.actionBtn}
            />
          </View>
          <MdButton
            title={archiving ? "Archiving..." : "Archive & Start New Semester"}
            variant="outlined"
            onPress={handleArchiveSemester}
            disabled={archiving}
            style={styles.actionBtn}
          />
        </View>

        <Text style={styles.sectionLabel}>DATA</Text>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="table-chart" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>Export attendance</Text>
          </View>
          <Text style={styles.cardBody}>
            Copies all your attendance records as CSV so you can paste them into a spreadsheet,
            back them up, or share them.
          </Text>
          <MdButton
            title={exporting ? "Copying..." : "Copy as CSV"}
            variant="filled"
            onPress={exportAttendanceCsv}
            disabled={exporting}
            style={styles.actionBtn}
          />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <MaterialIcons name="upload-file" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.cardTitle}>Import attendance</Text>
          </View>
          <Text style={styles.cardBody}>
            Paste edited or backed-up CSV data back in. Only the date, lectureId, and status
            columns are read - existing records for the same lecture and date are overwritten.
          </Text>

          {!showCsvImport && (
            <MdButton
              title="Paste CSV"
              variant="outlined"
              onPress={() => setShowCsvImport(true)}
              style={styles.actionBtn}
            />
          )}

          {showCsvImport && (
            <>
              <TextInput
                style={styles.jsonInput}
                value={csvInput}
                onChangeText={t => {
                  setCsvInput(t)
                  setCsvError(null)
                }}
                placeholder={"date,lectureId,subject,startTime,status\n2026-01-05,lec_1,AI,08:30,present"}
                placeholderTextColor={colors.onSurfaceVariant}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
              />
              {csvError && (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{csvError}</Text>
                </View>
              )}
              <View style={styles.row}>
                <MdButton
                  title="Cancel"
                  variant="text"
                  onPress={() => {
                    setShowCsvImport(false)
                    setCsvInput("")
                    setCsvError(null)
                  }}
                />
                <MdButton
                  title={importing ? "Importing..." : "Import"}
                  variant="filled"
                  onPress={importAttendanceCsv}
                  disabled={importing}
                />
              </View>
            </>
          )}
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
  },
  semesterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing(3),
    paddingVertical: spacing(2)
  },
  semesterLabel: { ...typo.body },
  semesterDate: { ...typo.body, fontWeight: "600", color: colors.primary },
  semesterInputRow: {
    flexDirection: "row",
    gap: spacing(2),
    marginTop: spacing(3),
    alignItems: "center",
    flexWrap: "wrap"
  },
  body: { ...typo.body },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing(3)
  },
  holidayList: { marginTop: spacing(4), gap: spacing(1) },
  holidayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing(2),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider
  },
  holidayRowDate: { ...typo.body, fontWeight: "600" },
  holidayRowLabel: { fontSize: 12, color: colors.onSurfaceVariant, marginTop: 2 }
})
