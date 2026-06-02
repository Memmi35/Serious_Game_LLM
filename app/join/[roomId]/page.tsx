"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TrafficSimulation } from "@/components/traffic-simulation";

export default function JoinPage() {
  const { roomId } = useParams();
  const [userName, setUserName] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleJoin = async () => {
    if (!userName.trim()) return;
    setLoading(true);
    try {
      const response = await fetch("/api/join-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId, user_name: userName }),
      });
      const data = await response.json();
      if (data.status === "success") {
        setSessionId(data.session_id);
      } else {
        setError(data.message || "Failed to join");
      }
    } catch (e) {
      setError("An error occurred");
    }
    setLoading(false);
  };

  if (sessionId) {
    return <TrafficSimulation initialSessionId={sessionId} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Join Room {roomId}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="text-red-500 text-sm text-center">{error}</div>}
          <Input 
            placeholder="Enter your name" 
            value={userName} 
            onChange={(e) => setUserName(e.target.value)} 
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
          />
          <Button className="w-full" onClick={handleJoin} disabled={loading || !userName.trim()}>
            {loading ? "Joining..." : "Join Game"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
