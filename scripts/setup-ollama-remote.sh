#!/usr/bin/env bash
# Run this in a JupyterLab Terminal on the lab's compute server.
# Installs Ollama, pulls a model, and serves it bound to all interfaces
# so the admin's internal->external port mapping can reach it.
set -euo pipefail

MODEL="${1:-llama3.1}"
INTERNAL_PORT="${2:-11434}"

if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

# 0.0.0.0, not 127.0.0.1 — a container port mapping forwards to the
# container's network interface, not its loopback. Binding to loopback
# only would make the mapping connect and then get refused.
export OLLAMA_HOST="0.0.0.0:${INTERNAL_PORT}"

nohup ollama serve > "$HOME/ollama_serve.log" 2>&1 &
echo "ollama serve started, pid $!, logs at $HOME/ollama_serve.log"
echo "listening on 0.0.0.0:${INTERNAL_PORT}"
sleep 3

ollama pull "$MODEL"

echo
echo "Ollama is up on internal port ${INTERNAL_PORT} with model '$MODEL'."
echo "Ask the server admin to map internal port ${INTERNAL_PORT} to an"
echo "external port, the same way they did 8010 -> 8811 for the web app."
echo "Once you have the external host + port, set in .env.local:"
echo "  AGENT_MODE=ollama"
echo "  OLLAMA_BASE_URL=http://<external-host>:<external-port>"
echo "  OLLAMA_MODEL=$MODEL"
