"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Navigation, Plus, LogIn } from "lucide-react";

export default function Home() {
  const router = useRouter();
  const [roomId, setRoomId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreateRoom = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/create-room", { method: "POST" });
      const data = await response.json();
      if (data.status === "success") {
        router.push(`/admin/${data.room_id}`);
      }
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  const handleJoinRoom = () => {
    if (!roomId.trim()) return;
    router.push(`/join/${roomId.toUpperCase()}`);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <Card className="max-w-md w-full shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Navigation className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Traffic Simulation Game</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-semibold text-center mt-4">Join a Session</h3>
            <div className="flex gap-2">
              <Input
                placeholder="Enter Room Code (e.g. ABCD)"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="uppercase"
                onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
              />
              <Button onClick={handleJoinRoom} disabled={!roomId.trim()}>
                <LogIn className="h-4 w-4 mr-2" />
                Join
              </Button>
            </div>
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">OR</span>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-center">Host a Session</h3>
            <Button
              onClick={handleCreateRoom}
              className="w-full"
              variant="outline"
              disabled={loading}
            >
              <Plus className="h-4 w-4 mr-2" />
              {loading ? "Creating..." : "Create New Room (Admin)"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
