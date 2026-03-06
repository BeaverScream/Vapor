import { Button } from '../../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'

interface RoomEndedViewProps {
  message: string
  onBackToLobby: () => void
}

export function RoomEndedView({ message, onBackToLobby }: RoomEndedViewProps) {
  return (
    <Card className="relative z-10 w-full max-w-md border-white/30 bg-card/75 backdrop-blur-md">
      <CardHeader>
        <CardTitle>Room ended</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="secondary" className="w-full" onClick={onBackToLobby}>
          Back to lobby
        </Button>
      </CardContent>
    </Card>
  )
}
