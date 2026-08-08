// src/components/MdButton.tsx
import { Pressable, Text, StyleSheet, ViewStyle } from "react-native"
import { colors, radius } from "../theme"

type Variant = "filled" | "tonal" | "outlined" | "text" | "danger"

type Props = {
  title: string
  onPress: () => void
  variant?: Variant
  disabled?: boolean
  style?: ViewStyle
}

export default function MdButton({ title, onPress, variant = "filled", disabled, style }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style
      ]}
    >
      <Text style={[styles.text, variantTextStyles[variant], disabled && styles.disabledText]}>
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center"
  },
  text: { fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.85 },
  disabled: { backgroundColor: colors.neutralContainer },
  disabledText: { color: colors.onSurfaceVariant }
})

const variantStyles: Record<Variant, ViewStyle> = {
  filled: { backgroundColor: colors.primary },
  tonal: { backgroundColor: colors.primaryContainer },
  outlined: { borderWidth: 1, borderColor: colors.outline, backgroundColor: "transparent" },
  text: { backgroundColor: "transparent", paddingHorizontal: 12 },
  danger: { backgroundColor: colors.errorContainer }
}

const variantTextStyles: Record<Variant, { color: string }> = {
  filled: { color: colors.onPrimary },
  tonal: { color: colors.primaryDark },
  outlined: { color: colors.primary },
  text: { color: colors.primary },
  danger: { color: colors.error }
}
