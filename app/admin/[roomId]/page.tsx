"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, Clock, BarChart3, Trophy, History, TrendingUp } from "lucide-react";

export default function AdminPage() {
  const { roomId } = useParams();
  const [roomDetails, setRoomDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // In a real app we'd use Supabase Realtime to listen for player joins
  // For simplicity, we just poll the room state
  useEffect(() => {
    const fetchRoom = async () => {
      const res = await fetch(`/api/admin/room-state?room_id=${roomId}`);
      if (res.ok) {
        const data = await res.json();
        setRoomDetails(data);
      }
    };
    fetchRoom();
    const interval = setInterval(fetchRoom, 2000);
    return () => clearInterval(interval);
  }, [roomId]);

  const handleStart = async () => {
    setLoading(true);
    await fetch("/api/admin/room-action", {
      method: "POST",
      body: JSON.stringify({ room_id: roomId, action: "start" }),
    });
    setLoading(false);
  };

  const handleNextRound = async () => {
    setLoading(true);
    await fetch("/api/admin/room-action", {
      method: "POST",
      body: JSON.stringify({ room_id: roomId, action: "next_round" }),
    });
    setLoading(false);
  };

  if (!roomDetails) return <div className="p-8 text-center">Loading Room...</div>;

  const routeColors: Record<string, string> = {
    "Route A": "bg-blue-500",
    "Route B": "bg-violet-500",
    "Route C": "bg-orange-500",
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-3xl text-center">Admin Panel</CardTitle>
          <div className="text-center font-mono text-2xl mt-2 bg-muted p-2 rounded">
            Room Code: {roomId}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-between items-center text-lg">
            <span>Status: <strong>{roomDetails.room.status}</strong></span>
            <span>Current Round: <strong>{roomDetails.room.current_round} / {roomDetails.room.total_rounds}</strong></span>
          </div>

          {/* Submission Status */}
          {roomDetails.room.status === "playing" && (
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Users className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-lg">Submission Status</h3>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <span>{roomDetails.submittedCount || 0} submitted</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-500" />
                  <span>{roomDetails.totalPlayers - (roomDetails.submittedCount || 0)} waiting</span>
                </div>
                <Badge 
                  variant={roomDetails.allSubmitted ? "default" : "secondary"}
                  className={roomDetails.allSubmitted ? "bg-green-500" : ""}
                >
                  {roomDetails.allSubmitted ? "All Submitted" : "Pending"}
                </Badge>
              </div>
            </div>
          )}

          {/* Choice Distribution */}
          {roomDetails.room.status === "playing" && roomDetails.submittedCount > 0 && (
            <div className="p-4 rounded-lg border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-lg">Choice Distribution</h3>
                <Badge variant="outline" className="ml-auto">
                  Round {roomDetails.room.current_round}
                </Badge>
              </div>
              <div className="space-y-3">
                {["Route A", "Route B", "Route C"].map((routeName) => {
                  const count = roomDetails.choiceDistribution?.[routeName] || 0;
                  const percentage = roomDetails.submittedCount > 0 
                    ? Math.round((count / roomDetails.submittedCount) * 100) 
                    : 0;
                  
                  return (
                    <div key={routeName} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{routeName}</span>
                        <span className="text-muted-foreground">
                          {count} player{count !== 1 ? "s" : ""} ({percentage}%)
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-3">
                        <div 
                          className={`h-3 rounded-full transition-all duration-300 ${routeColors[routeName]}`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t pt-4">
            <h3 className="font-semibold mb-2 text-xl flex items-center gap-2">
              <Users className="h-5 w-5" />
              Players Joined ({roomDetails.sessions.length})
            </h3>
            <ul className="space-y-2">
              {roomDetails.sessions.map((session: any) => (
                <li key={session.id} className="bg-muted p-3 rounded flex justify-between items-center">
                  <span className="font-medium">{session.user_name || "Player"}</span>
                  <div className="flex items-center gap-2">
                    {session.has_submitted ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Submitted
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-200">
                        <Clock className="h-3 w-3 mr-1" />
                        Choosing
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-4 flex gap-4 justify-center">
            {roomDetails.room.status === "waiting" && (
              <Button onClick={handleStart} size="lg" disabled={loading}>
                Start Game
              </Button>
            )}
            
            {roomDetails.room.status === "playing" && (
              <div className="text-center space-y-2">
                <Button 
                  onClick={handleNextRound} 
                  size="lg" 
                  disabled={loading}
                  className="w-full"
                >
                  Advance to Next Round
                </Button>
                <p className="text-sm text-muted-foreground">
                  {roomDetails.allSubmitted 
                    ? "All players have submitted their choices" 
                    : `Waiting for ${roomDetails.totalPlayers - (roomDetails.submittedCount || 0)} player(s) to submit`}
                </p>
              </div>
            )}

            {roomDetails.room.status === "completed" && (
              <div className="text-lg text-green-500 font-bold text-center">Game Completed!</div>
            )}
          </div>

          {/* Game History - Show when completed */}
          {roomDetails.room.status === "completed" && roomDetails.gameHistory && (
            <div className="space-y-6 border-t pt-6">
              <div className="flex items-center gap-2">
                <History className="h-6 w-6 text-primary" />
                <h2 className="text-2xl font-bold">Game History</h2>
              </div>

              {/* Player Leaderboard */}
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  <h3 className="font-semibold text-lg">Player Leaderboard</h3>
                </div>
                <div className="space-y-3">
                  {roomDetails.gameHistory.playerStats
                    ?.sort((a: any, b: any) => a.total_realized_time - b.total_realized_time)
                    .map((player: any, index: number) => (
                      <div 
                        key={player.session_id} 
                        className={`p-3 rounded-lg border ${index === 0 ? 'bg-yellow-500/10 border-yellow-300' : 'bg-muted/50'}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`text-lg font-bold ${index === 0 ? 'text-yellow-600' : 'text-muted-foreground'}`}>
                              #{index + 1}
                            </span>
                            <span className="font-medium">{player.user_name}</span>
                            {index === 0 && <Badge className="bg-yellow-500">Winner</Badge>}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold">{player.total_realized_time.toFixed(1)} min</div>
                            <div className="text-xs text-muted-foreground">
                              Avg: {player.avg_realized_time.toFixed(1)} min/round
                            </div>
                          </div>
                        </div>
                        <div className="mt-2 flex gap-2 flex-wrap">
                          {Object.entries(player.route_choices || {}).map(([route, count]: [string, any]) => (
                            <Badge key={route} variant="outline" className="text-xs">
                              {route}: {count}x
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Round by Round Stats */}
              <div className="p-4 rounded-lg border bg-card">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Round by Round Analysis</h3>
                </div>
                <div className="space-y-4">
                  {roomDetails.gameHistory.roundStats?.map((round: any) => (
                    <div key={round.round} className="p-3 rounded-lg bg-muted/50 border">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">Round {round.round}</Badge>
                        <span className="text-sm text-muted-foreground">
                          {round.playerCount} player{round.playerCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      
                      {/* Distribution for this round */}
                      <div className="space-y-2 mb-3">
                        {["Route A", "Route B", "Route C"].map((routeName) => {
                          const count = round.distribution?.[routeName] || 0;
                          const percentage = round.playerCount > 0 
                            ? Math.round((count / round.playerCount) * 100) 
                            : 0;
                          
                          return (
                            <div key={routeName} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span>{routeName}</span>
                                <span>{count} ({percentage}%)</span>
                              </div>
                              <div className="w-full bg-background rounded-full h-2">
                                <div 
                                  className={`h-2 rounded-full ${routeColors[routeName]}`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Individual choices */}
                      <div className="border-t pt-2 mt-2">
                        <div className="text-xs text-muted-foreground mb-1">Individual Choices:</div>
                        <div className="flex flex-wrap gap-1">
                          {round.logs?.map((log: any, idx: number) => (
                            <Badge 
                              key={idx} 
                              variant="secondary" 
                              className="text-xs"
                            >
                              {log.user_name}: {log.chosen_route} ({log.realized_time?.toFixed(1)}m)
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
