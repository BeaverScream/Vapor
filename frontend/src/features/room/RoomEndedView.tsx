import { memo } from 'react'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

interface RoomEndedViewProps {
  message: string
  onBackToLobby: () => void
}

export const RoomEndedView = memo(function RoomEndedView({ message, onBackToLobby }: RoomEndedViewProps) {
  return (
    <Card className="relative z-10 w-full max-w-[26rem] text-center">
      <CardHeader>
        <CardTitle className="font-display text-xl font-semibold">Room ended</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="secondary" className="w-full" onClick={onBackToLobby}>
          Back to lobby
        </Button>
      </CardContent>
    </Card>
  )
})
