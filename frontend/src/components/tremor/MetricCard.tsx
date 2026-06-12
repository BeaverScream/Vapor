import { cn } from '../../lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string
  className?: string
}

function MetricCard({ title, value, subtitle, className }: MetricCardProps) {
  return (
    <Card className={cn('py-4', className)}>
      <CardHeader className="px-5 pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pt-1">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  )
}

export { MetricCard, type MetricCardProps }
