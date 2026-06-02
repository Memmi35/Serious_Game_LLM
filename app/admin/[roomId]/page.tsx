"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  return (
    <div className="min-h-screen bg-background p-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-3xl text-center">Admin Panel</CardTitle>
          <div className="text-center font-mono text-2xl mt-2 bg-muted p-2 rounded">
            Room Code: {roomId}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center text-lg">
            <span>Status: <strong>{roomDetails.room.status}</strong></span>
            <span>Current Round: <strong>{roomDetails.room.current_round} / {roomDetails.room.total_rounds}</strong></span>
          </div>

          <div className="mt-8 border-t pt-4">
            <h3 className="font-semibold mb-2 text-xl">Players Joined ({roomDetails.sessions.length})</h3>
            <ul className="space-y-2">
              {roomDetails.sessions.map((session: any) => (
                <li key={session.id} className="bg-muted p-2 rounded flex justify-between">
                  <span>{session.user_name || "Player"}</span>
                  <span className="text-sm text-muted-foreground">Round {session.current_round}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-8 flex gap-4 justify-center">
            {roomDetails.room.status === "waiting" && (
              <Button onClick={handleStart} size="lg" disabled={loading}>
                Start Game
              </Button>
            )}
            
            {roomDetails.room.status === "playing" && (
              <Button onClick={handleNextRound} size="lg" disabled={loading}>
                Next Round
              </Button>
            )}

            {roomDetails.room.status === "completed" && (
              <div className="text-lg text-green-500 font-bold">Game Completed!</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
