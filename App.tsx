// App.tsx
import { useEffect } from "react"
import { NavigationContainer, DefaultTheme } from "@react-navigation/native"
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs"
import { MaterialIcons } from "@expo/vector-icons"
import { StatusBar } from "expo-status-bar"

import TodayScreen from "./src/screens/TodayScreen"
import TimetableScreen from "./src/screens/TimetableScreen"
import StatsScreen from "./src/screens/StatsScreen"
import SettingsScreen from "./src/screens/SettingsScreen"
import { colors } from "./src/theme"
import { ensureNotificationPermission } from "./src/utils/notifications"

const Tab = createBottomTabNavigator()

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
    <NavigationContainer theme={navTheme}>
      <StatusBar style="dark" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerTitleStyle: { fontWeight: "600", fontSize: 20, color: colors.onSurface },
          headerStyle: { backgroundColor: colors.surface, elevation: 0, shadowOpacity: 0 },
          headerShadowVisible: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.onSurfaceVariant,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
            height: 60,
            paddingBottom: 8,
            paddingTop: 6
          },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "500" },
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name={ICONS[route.name]} size={size} color={color} />
          )
        })}
      >
        <Tab.Screen name="Today" component={TodayScreen} />
        <Tab.Screen name="Timetable" component={TimetableScreen} />
        <Tab.Screen name="Stats" component={StatsScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  )
}
