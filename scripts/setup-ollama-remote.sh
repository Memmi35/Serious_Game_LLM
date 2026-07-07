#!/usr/bin/env bash
# Run this in a JupyterLab Terminal on the lab's compute server, in the
# same container that runs the Next.js app. Installs Ollama, pulls a
# model, and serves it on localhost — no external port needed, since
# the app and the model run in the same container.
set -euo pipefail

MODEL="${1:-llama3.1}"

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

nohup ollama serve > "$HOME/ollama_serve.log" 2>&1 &
echo "ollama serve started, pid $!, logs at $HOME/ollama_serve.log"
sleep 3

ollama pull "$MODEL"

echo
echo "Ollama is up on localhost:11434 with model '$MODEL'."
echo "In the .env.local used by the app running in THIS container, set:"
echo "  AGENT_MODE=ollama"
echo "  OLLAMA_BASE_URL=http://localhost:11434"
echo "  OLLAMA_MODEL=$MODEL"
echo "Then restart the Next.js dev server so it picks up the new env vars."
