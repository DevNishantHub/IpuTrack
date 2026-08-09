// src/AppContent.tsx
import { useEffect } from "react"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { NavigationContainer, DefaultTheme } from "@react-navigation/native"
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
import { ensureNotificationPermission } from "./utils/notifications"

const Tab = createMaterialTopTabNavigator()

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
    ensureNotificationPermission()
      .then(granted => {
        if (!granted) {
          console.warn("Notification permission not granted; low-attendance alerts will be disabled.")
        }
      })
      .catch(err => {
        console.warn("Failed to set up notification permissions:", err)
      })
  }, [])

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
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
          <Tab.Screen name="Settings" component={SettingsScreen} />
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
