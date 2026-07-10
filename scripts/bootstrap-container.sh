#!/usr/bin/env bash
# Run this after a container reset (new container, or an existing one that
# lost its non-persistent layer). Assumes ~/work/<this repo> survived on the
# persistent volume but game_env/Ollama/node_modules did not.
#
# Usage: cd into the project folder first, then run this script.
set -euo pipefail

MODEL="${1:-qwen2.5:3b}"

echo "--- fixing git ownership/permissions if needed ---"
git config --global --add safe.directory "$(pwd)" || true
if [ ! -w .git ]; then
  sudo chown -R "$(whoami)":"$(whoami)" . || true
fi

echo "--- recreating game_env (Node 20) ---"
conda create -n game_env nodejs=20 -y
source /opt/conda/etc/profile.d/conda.sh
conda activate game_env

echo "--- installing JS dependencies ---"
rm -rf node_modules
npm install

echo "--- installing Ollama ---"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "--- starting Ollama and pulling model ---"
nohup ollama serve > "$HOME/ollama_serve.log" 2>&1 &
sleep 3
ollama pull "$MODEL"

echo
echo "Done. .env.local should already have AGENT_MODE=ollama set (check with"
echo "  cat .env.local"
echo "if not, add:"
echo "  AGENT_MODE=ollama"
echo "  OLLAMA_BASE_URL=http://localhost:11434"
echo "  OLLAMA_MODEL=$MODEL              # PersuLLM advisor model — the experimental variable"
echo "  AGENT_POPULATION_MODEL=$MODEL    # the 30 agents' model — keep this fixed across experiments"
echo "(pull additional models with 'ollama pull <name>' to swap OLLAMA_MODEL between runs)"
echo
echo "Start the app with:"
echo "  npm run dev -- -p 8010"
