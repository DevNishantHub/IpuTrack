// App.tsx
import { Platform, Text, View, StyleSheet } from "react-native"
import { colors } from "./src/theme"

// On web, Skia's CanvasKit (WASM) has to be fetched and initialized
// asynchronously before any component that uses @shopify/react-native-skia
// (i.e. our victory-native charts) can render. WithSkiaWeb handles that
// loading step and only mounts the app once CanvasKit is ready.
// On native (iOS/Android) Skia is a native module that's ready immediately,
// so we skip the wrapper there.
export default function App() {
  if (Platform.OS === "web") {
    const { WithSkiaWeb } = require("@shopify/react-native-skia/lib/module/web")
    const { version } = require("canvaskit-wasm/package.json")
    return (
      <WithSkiaWeb
        getComponent={() => import("./src/AppContent")}
        opts={{
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${version}/bin/full/${file}`
        }}
        fallback={
          <View style={styles.loading}>
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        }
      />
    )
  }

  const AppContent = require("./src/AppContent").default
  return <AppContent />
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background
  },
  loadingText: {
    color: colors.onSurfaceVariant,
    fontSize: 14
  }
})
