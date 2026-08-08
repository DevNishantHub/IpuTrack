// src/theme.ts
// Material Design tokens, styled after Google's own apps.
export const colors = {
  primary: "#1a73e8",       // Google blue
  primaryDark: "#1557b0",
  onPrimary: "#ffffff",
  primaryContainer: "#e8f0fe",

  surface: "#ffffff",
  background: "#f8f9fa",
  onSurface: "#202124",
  onSurfaceVariant: "#5f6368",
  outline: "#dadce0",

  success: "#188038",
  successContainer: "#e6f4ea",
  error: "#d93025",
  errorContainer: "#fce8e6",
  neutralContainer: "#e8eaed",

  divider: "#e8eaed"
}

export const elevation = {
  1: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 1
  },
  2: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3
  }
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999
}

export const type = {
  headline: { fontSize: 22, fontWeight: "500" as const, color: colors.onSurface },
  title: { fontSize: 16, fontWeight: "500" as const, color: colors.onSurface },
  body: { fontSize: 14, fontWeight: "400" as const, color: colors.onSurface },
  label: { fontSize: 12, fontWeight: "500" as const, color: colors.onSurfaceVariant }
}

export const spacing = (n: number) => n * 4
