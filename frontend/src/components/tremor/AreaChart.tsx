import {
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { cn } from '../../lib/utils'

interface AreaChartProps {
  data: Record<string, string | number>[]
  index: string
  categories: string[]
  colors?: string[]
  valueFormatter?: (value: number) => string
  showGridLines?: boolean
  className?: string
}

const DEFAULT_COLORS = ['#6b9fd4', '#a78bfa', '#34d399', '#fb923c', '#f87171']

function AreaChart({
  data,
  index,
  categories,
  colors = DEFAULT_COLORS,
  valueFormatter = (v) => String(v),
  showGridLines = true,
  className,
}: AreaChartProps) {
  return (
    <div className={cn('h-52 w-full', className)}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsAreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          {showGridLines && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />}
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
            <Area
              key={cat}
              type="monotone"
              dataKey={cat}
              stroke={colors[i % colors.length]}
              fill={colors[i % colors.length]}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </RechartsAreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export { AreaChart, type AreaChartProps }
