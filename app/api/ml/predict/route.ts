import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    
    return new Promise((resolve) => {
      // Correct path to the Python script
      const scriptPath = path.join(process.cwd(), "model", "predict_edges.py");
      
      const pyProcess = spawn("python3", [scriptPath]);
      
      let outputData = "";
      let errorData = "";

      pyProcess.stdout.on("data", (chunk) => {
        outputData += chunk.toString();
      });

      pyProcess.stderr.on("data", (chunk) => {
        errorData += chunk.toString();
      });

      pyProcess.on("close", (code) => {
        if (code !== 0) {
          console.error("Python script exited with code", code);
          console.error("stderr:", errorData);
          resolve(
            NextResponse.json(
              { error: "Model prediction failed", details: errorData },
              { status: 500 }
            )
          );
          return;
        }

        try {
          const result = JSON.parse(outputData);
          if (result.error) {
            resolve(
              NextResponse.json(
                { error: result.error },
                { status: 500 }
              )
            );
          } else {
            resolve(NextResponse.json({ predictions: result.predictions }));
          }
        } catch (e) {
          console.error("Failed to parse Python output:", outputData);
          resolve(
            NextResponse.json(
              { error: "Invalid model output format" },
              { status: 500 }
            )
          );
        }
      });

      // Write input to the python process
      pyProcess.stdin.write(JSON.stringify(data));
      pyProcess.stdin.end();
    });
  } catch (error) {
    console.error("Error processing ml prediction:", error);
    return NextResponse.json(
      { status: "error", message: "Failed to process ml prediction" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    model_loaded: true,
    model_type: "RandomForestRegressor (Python)",
  });
}
