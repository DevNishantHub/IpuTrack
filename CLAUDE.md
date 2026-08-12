# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Attendance App** — React Native / Expo app for tracking college class attendance. Four tabs: Today (mark/edit attendance), Timetable (read-only master view), Stats (percentages + bunk planning), Settings (import timetable via AI JSON, CSV import/export, reminders, holidays, semester archiving).

## Commands

```bash
# Start dev server
npm start          # expo start
npm run android    # expo start --android
npm run ios        # expo start --ios
npm run web        # expo start --web

# Test
npm test           # jest
```

## Architecture

### Data Model (src/types.ts)
- **Lecture** — master timetable entry: `id, subject, day(0-6), startTime("H:MM"), note?`
- **Attendance** — one record per (lectureId, date): `id, lectureId, date, status(present|absent|cancelled)`
- **DayOverride** — one-off edit for a single date: `id, date, lectureId, subject?, startTime?, note?, cancelled?`
- **ExtraLecture** — one-off class added for a single date: `id, date, subject, startTime, note?`
- **Holiday** — date with no classes (pure calendar flag, never mutates attendance)
- **ArchivedSemester** — snapshot of attendance + lectures at archive time
- **Break** — break slots for timetable grid rendering only

### Storage (src/storage/storage.ts)
Single AsyncStorage keys per entity. All mutating writes serialized through `withWriteLock` (promise chain) to avoid lost updates from interleaved reads.

Key functions:
- `getLectures()` / `setMasterTimetable()` — master timetable (replace-only, remaps old attendance ids by deterministic `subject-day-time` identity)
- `getAttendance()` / `saveAttendance()` / `deleteAttendance()` — upserts on deterministic `lectureId-date` id
- `getOverridesForDate()` / `saveOverride()` / `clearOverride()` — day overrides, auto-pruned past today
- `getExtraLecturesForDate()` / `saveExtraLecture()` — one-off classes
- `applyCsvDayPlans()` — atomic rebuild of a date from CSV (source of truth for that day)
- `getHolidays()` / `addHoliday()` / `removeHoliday()` — calendar flags
- `archiveCurrentSemester()` — snapshots attendance, clears it, sets new semester start
- `getReminderSettings()` / `setReminderSettings()` + signature key for cold-start re-sync

Deterministic ids: `slugifyId(subject)-day-timeToken` (e.g. `ai-1-8-30`). Re-importing timetable remaps old attendance to new ids by matching this identity, so attendance survives re-imports.

### Attendance Math (src/utils/attendance.ts)
- `calculateStats()` — present/absent/cancelled counts, percentage = present / (present+absent)
- `calculateBunkInfo()` — how many future classes can skip / must attend to reach threshold
  - Master timetable classes only count as "future"; extras (one-off) count in attended but not future
  - Formula: `maxAbsentAllowed = floor(present * 100 / threshold - attendedClasses)`
- `getAttendanceTrend()` — cumulative percentage per date (filtered by semester start)
- `checkLowAttendanceAndNotify()` — fires notification when subject drops below threshold

### CSV Import/Export (src/utils/csv.ts)
- Export: `attendanceToCsv()` — columns `date,lectureId,subject,startTime,status`. Uses overrides/extras for display values. Skips cancelled overrides.
- Import: `parseAttendanceCsv()` → `CsvDayPlan[]` per date. Each date is a **complete snapshot**: rows attach to master by subject+day (lab-room suffix normalized), unmatched become ExtraLecture, master classes missing from CSV get cancelled override.
- `normalizeSubject()` strips trailing lab numbers ("AI Lab 4" → "AI Lab") so variants collapse to one stats card.

### Timetable Import (src/utils/timetableImport.ts)
User copies prompt → pastes into AI with timetable photo → AI returns JSON array → app validates via `validateImportedTimetable()` → `setMasterTimetable()` replaces master and remaps attendance.

### Notifications (src/utils/notifications.ts)
- Low-attendance: immediate push when marking drops subject below threshold (once per subject until recovery)
- Class reminders: weekly recurring scheduled via expo-notifications, `minutesBefore` each lecture. **Follows permanent timetable only** — day overrides (edit for today) do NOT shift/skip reminders.
- Cold-start re-sync on every launch: compares fingerprint of (lectures + minutesBefore) against stored signature; skips cancel+reschedule if unchanged.

### Screens
- **TodayScreen** — selected date (default today, navigable). Merges master + overrides + extras for display. Inline confirm for remove (works on web). Modal for edit/add. `useFocusEffect` reloads on tab focus.
- **TimetableScreen** — read-only sorted grid of master lectures + breaks. `useFocusEffect` reloads.
- **StatsScreen** — overall ring + per-subject cards with progress bar, can-skip/must-attend, threshold, trend chart on tap. `useFocusEffect` reloads. Subjects from both master + extras, collapsed by normalized name.
- **SettingsScreen** — AI JSON import flow, threshold, reminders toggle+minutes, holidays, semester archive/date, CSV export/import.

### Key Patterns
- **No in-app master timetable editing** — only replace via AI import (Settings) or CSV rebuild (import attendance). Day edits are overrides (Today tab).
- **Overrides/Extras/Holidays are date-scoped** — never mutate master.
- **Attendance id = lectureId-date** — deterministic, upserts naturally.
- **writeChain** serializes all AsyncStorage writes.
- **safeJsonParse** — defensive parsing, returns fallback on corruption.
- **subject normalization** — lab-room suffix stripped for matching, but master spelling used for display.

## Test Structure
```
src/utils/__tests__/
  attendance.test.ts
  dateHelpers.test.ts
  csv.test.ts
  notifications.test.ts
  attendance.extra.test.ts
  csv.extra.test.ts
  timetableImport.test.ts
src/storage/__tests__/
  storage.test.ts
```
Jest with ts-jest, `testMatch: "**/__tests__/**/*.test.ts"`, mocks for expo-notifications and async-storage in package.json.

## Dependencies (key)
- Expo 57, React 19, React Native 0.86
- Navigation: @react-navigation/native + bottom-tabs + material-top-tabs
- Storage: @react-native-async-storage/async-storage
- Notifications: expo-notifications
- Charts: victory-native (AttendanceChart)
- Icons: @expo/vector-icons