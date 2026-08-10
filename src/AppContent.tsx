// src/AppContent.tsx
import { useEffect } from "react"
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native"
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from "@react-navigation/native"
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs"
import type { MaterialTopTabBarProps } from "@react-navigation/material-top-tabs"
import { MaterialIcons } from "@expo/vector-icons"
import { StatusBar } from "expo-status-bar"
import { SafeAreaView, SafeAreaProvider } from "react-native-safe-area-context"

import TodayScreen from "./screens/TodayScreen"
import TimetableScreen from "./screens/TimetableScreen"
import StatsScreen from "./screens/StatsScreen"
import SettingsScreen from "./screens/SettingsScreen"
import { colors, spacing } from "./theme"
import { ensureNotificationPermission, scheduleClassReminders } from "./utils/notifications"
import {
  getReminderSettings,
  getLectures,
  isTimetableImported,
  getReminderScheduleSignature,
  setReminderScheduleSignature
} from "./storage/storage"

const Tab = createMaterialTopTabNavigator()

// Lets the "go to Settings" popup below navigate without needing to be
// rendered inside the Tab.Navigator itself.
const navigationRef = createNavigationContainerRef()

// Name of the tab the first-run onboarding nudge below sends the user to.
// Kept as a single named constant (rather than a string literal repeated at
// each call site) so the one place that currently cares about "where does
// onboarding send people" is easy to find if that ever needs to change.
const ONBOARDING_DESTINATION_TAB = "Settings"

// navigationRef.isReady() can still be false for a brief window after this
// effect starts (AsyncStorage reads can resolve before NavigationContainer
// finishes its first mount, especially on a slow cold start) - a plain
// `if (isReady()) navigate()` can silently no-op right when the user taps
// the button. Poll briefly instead of navigating immediately so a
// still-mounting navigator doesn't swallow the tap.
function navigateWhenReady(name: string, retriesLeft = 20): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as never)
    return
  }
  if (retriesLeft <= 0) {
    console.warn(`navigateWhenReady: navigator never became ready, dropping navigation to "${name}"`)
    return
  }
  setTimeout(() => navigateWhenReady(name, retriesLeft - 1), 50)
}

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    border: colors.divider
  }
}

const ICONS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  Today: "today",
  Timetable: "calendar-view-week",
  Stats: "bar-chart",
  Settings: "settings"
}

// Renders like the original bottom tab bar (icon + label per screen), but
// sits on top of a swipeable material-top-tabs navigator so tapping a tab
// still works exactly as before while dragging left/right between screens
// now also works.
function BottomStyleTabBar({ state, descriptors, navigation }: MaterialTopTabBarProps) {
  return (
    <SafeAreaView edges={["bottom"]} style={styles.tabBar}>
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]
        const isFocused = state.index === index
        const label =
          typeof options.tabBarLabel === "string" ? options.tabBarLabel : route.name

        const onPress = () => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true
          })
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name)
          }
        }

        const color = isFocused ? colors.primary : colors.onSurfaceVariant

        return (
          <TouchableOpacity
            key={route.key}
            accessibilityRole="button"
            accessibilityState={isFocused ? { selected: true } : {}}
            onPress={onPress}
            style={styles.tabItem}
          >
            <MaterialIcons name={ICONS[route.name]} size={24} color={color} />
            <Text style={[styles.tabLabel, { color }]}>{label}</Text>
          </TouchableOpacity>
        )
      })}
    </SafeAreaView>
  )
}

export default function App() {
  useEffect(() => {
    // Cold-start check: with no seeded/placeholder data, a fresh install has
    // an empty timetable until the user imports their own via Settings.
    // Nudge them there right away instead of leaving Today/Timetable blank
    // with no explanation.
    isTimetableImported()
      .then(imported => {
        if (imported) return
        Alert.alert(
          "Set up your timetable",
          "You haven't added a timetable yet. Go to Settings to paste in your timetable JSON.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Go to Settings",
              onPress: () => navigateWhenReady(ONBOARDING_DESTINATION_TAB)
            }
          ]
        )
      })
      .catch(err => {
        console.warn("Failed to check timetable import status on startup:", err)
      })

    ensureNotificationPermission()
      .then(async granted => {
        if (!granted) {
          console.warn("Notification permission not granted; low-attendance alerts will be disabled.")
          return
        }

        // Re-sync class reminders on every cold start. This guards against
        // the OS clearing pending notifications, or the timetable having
        // changed while the app was closed - without this, reminders could
        // silently drift out of sync with the actual schedule. The actual
        // cancel+reschedule work is skipped below when nothing relevant has
        // changed since the last time it ran, so repeated launches in the
        // same day don't keep re-doing the same OS calls for no reason.
        try {
          const settings = await getReminderSettings()
          if (!settings.enabled) return

          const lectures = await getLectures()
          const signature = JSON.stringify({
            minutesBefore: settings.minutesBefore,
            lectures: lectures.map(l => ({
              id: l.id,
              day: l.day,
              startTime: l.startTime,
              subject: l.subject,
              note: l.note
            }))
          })

          const lastSignature = await getReminderScheduleSignature()
          if (lastSignature === signature) return

          await scheduleClassReminders(lectures, settings.minutesBefore)
          await setReminderScheduleSignature(signature)
        } catch (err) {
          console.warn("Failed to re-sync class reminders on startup:", err)
        }
      })
      .catch(err => {
        console.warn("Failed to set up notification permissions:", err)
      })
  }, [])

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme}>
        <StatusBar style="dark" />
        <Tab.Navigator
          tabBarPosition="bottom"
          tabBar={props => <BottomStyleTabBar {...props} />}
          screenOptions={{
            swipeEnabled: true,
            animationEnabled: true,
            lazy: true
          }}
        >
          <Tab.Screen name="Today" component={TodayScreen} />
          <Tab.Screen name="Timetable" component={TimetableScreen} />
          <Tab.Screen name="Stats" component={StatsScreen} />
          <Tab.Screen name={ONBOARDING_DESTINATION_TAB} component={SettingsScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: spacing(1.5),
    paddingBottom: spacing(1)
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2
  }
})
