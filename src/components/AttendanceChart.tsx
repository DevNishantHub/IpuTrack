// src/components/AttendanceChart.tsx
import { useMemo } from "react"
import { View, Text, StyleSheet, Dimensions } from "react-native"
import { CartesianChart, Line } from "victory-native"
import { matchFont } from "@shopify/react-native-skia"
import { colors, spacing, type as typo } from "../theme"

type TrendPoint = { date: string; percentage: number }

type AttendanceChartProps = {
  data: TrendPoint[]
  subject: string
  threshold?: number
  height?: number
}

type ChartRow = { x: number; y: number; threshold: number }

export default function AttendanceChart({ data, subject, threshold = 75, height = 200 }: AttendanceChartProps) {
  const { width } = Dimensions.get("window")
  const chartWidth = width - spacing(8)

  const axisFont = useMemo(() => {
    try {
      return matchFont({ fontFamily: "System", fontSize: 10 })
    } catch {
      return null
    }
  }, [])

  // Each row carries both the actual attendance value and the threshold value
  // so CartesianChart can plot them as two yKeys sharing the same x/domain.
  const chartData: ChartRow[] = useMemo(() => {
    return data.map((d, i) => ({
      x: i,
      y: d.percentage,
      threshold
    }))
  }, [data, threshold])

  const labels = useMemo(() => data.map(d => d.date), [data])

  const yDomain = useMemo(() => {
    if (data.length === 0) return [0, 100] as [number, number]
    const values = data.map(d => d.percentage).concat(threshold)
    const minY = Math.max(0, Math.min(...values) - 10)
    const maxY = Math.min(100, Math.max(...values) + 10)
    return [minY, maxY] as [number, number]
  }, [data, threshold])

  if (data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No attendance data for {subject} this semester</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{subject} Attendance Trend</Text>
      <View style={{ width: chartWidth, height }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["y", "threshold"]}
          domainPadding={{ left: 16, right: 16, top: 10, bottom: 10 }}
          xAxis={{
            font: axisFont,
            formatXLabel: (value) => {
              const label = labels[Math.round(value)]
              return label ? label.slice(5) : ""
            },
            lineColor: colors.outline,
            labelColor: colors.onSurfaceVariant,
            labelRotate: -45
          }}
          yAxis={[
            {
              yKeys: ["y", "threshold"],
              domain: yDomain,
              font: axisFont,
              formatYLabel: (value) => `${Math.round(value)}%`,
              lineColor: colors.outline,
              labelColor: colors.onSurfaceVariant
            }
          ]}
        >
          {({ points }) => (
            <>
              <Line
                points={points.threshold}
                color={colors.error}
                strokeWidth={1}
                curveType="natural"
                dashArray={[5, 5]}
              />
              <Line
                points={points.y}
                color={colors.primary}
                strokeWidth={2}
                curveType="natural"
              />
            </>
          )}
        </CartesianChart>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, { backgroundColor: colors.primary }]} />
          <Text style={styles.legendText}>Attendance</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={styles.legendDashRow}>
            <View style={styles.legendDash} />
            <View style={styles.legendDash} />
            <View style={styles.legendDash} />
          </View>
          <Text style={styles.legendText}>{threshold}% threshold</Text>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(3),
    alignItems: "center"
  },
  title: {
    ...typo.title,
    fontSize: 14,
    marginBottom: spacing(2),
    color: colors.onSurface
  },
  emptyContainer: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing(6),
    alignItems: "center"
  },
  emptyText: {
    ...typo.body,
    color: colors.onSurfaceVariant,
    textAlign: "center"
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: spacing(2),
    gap: spacing(5)
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5)
  },
  legendSwatch: {
    width: 14,
    height: 3,
    borderRadius: 1.5
  },
  legendDashRow: {
    flexDirection: "row",
    alignItems: "center",
    width: 14,
    justifyContent: "space-between"
  },
  legendDash: {
    width: 3,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.error
  },
  legendText: {
    ...typo.label,
    fontSize: 11,
    color: colors.onSurfaceVariant
  }
})
