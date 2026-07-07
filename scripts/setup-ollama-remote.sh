#!/usr/bin/env bash
# Run this in a JupyterLab Terminal on the lab's compute server.
# Installs Ollama, pulls a model, and serves it on port 11434.
set -euo pipefail

MODEL="${1:-llama3.1}"

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Serve in the background so this terminal stays usable.
nohup ollama serve > "$HOME/ollama_serve.log" 2>&1 &
echo "ollama serve started, pid $!, logs at $HOME/ollama_serve.log"
sleep 3

ollama pull "$MODEL"

echo
echo "Ollama is running on 127.0.0.1:11434 with model '$MODEL'."
echo "From your LOCAL machine, forward this port over SSH, e.g.:"
echo "  ssh -N -L 11434:localhost:11434 <your-user>@<lab-server-host>"
echo "Then in .env.local set:"
echo "  AGENT_MODE=ollama"
echo "  OLLAMA_BASE_URL=http://localhost:11434"
echo "  OLLAMA_MODEL=$MODEL"
