import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '../../lib/utils'

interface BarChartProps {
  data: Record<string, string | number>[]
  index: string
  categories: string[]
  colors?: string[]
  valueFormatter?: (value: number) => string
  showGridLines?: boolean
  layout?: 'horizontal' | 'vertical'
  className?: string
}

const DEFAULT_COLORS = ['#6b9fd4', '#a78bfa', '#34d399', '#fb923c', '#f87171']

function BarChart({
  data,
  index,
  categories,
  colors = DEFAULT_COLORS,
  valueFormatter = (v) => String(v),
  showGridLines = true,
  layout = 'horizontal',
  className,
}: BarChartProps) {
  const isVertical = layout === 'vertical'

  return (
    <div className={cn('h-52 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data}
          layout={layout}
          margin={{ top: 4, right: 4, left: isVertical ? 60 : -20, bottom: 0 }}
        >
          {showGridLines && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />}
          {isVertical ? (
            <>
              <YAxis
                dataKey={index}
                type="category"
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)' }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)' }}
                axisLine={false}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={index}
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.45)' }}
                axisLine={false}
                tickLine={false}
              />
            </>
          )}
          <Tooltip
            contentStyle={{
              background: 'rgba(15,22,40,0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px',
              fontSize: 12,
            }}
            formatter={(v) => [valueFormatter(Number(v))]}
          />
          {categories.map((cat, i) => (
            <Bar
              key={cat}
              dataKey={cat}
              fill={colors[i % colors.length]}
              fillOpacity={0.85}
              radius={[3, 3, 0, 0]}
            />
          ))}
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  )
}

export { BarChart, type BarChartProps }
