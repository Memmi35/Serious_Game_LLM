#!/usr/bin/env python3
"""Generates JPG charts from a room's exported analysis JSON files
(optimal-vs-actual.mjs and room-analysis.mjs output). Run those two scripts
first to produce the JSON this reads.

Usage:
    python3 scripts/simulated-population/generate-charts.py <room_id> [out_dir]
"""

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt

REPO_ROOT = Path(__file__).resolve().parents[2]

# Same categorical palette as the dataviz skill's validated default.
COLOR_A = "#2a78d6"
COLOR_B = "#1baf7a"
COLOR_C = "#eda100"
COLOR_OPTIMAL = "#52514e"
GRID = "#e1e0d9"
TEXT = "#0b0b0b"
TEXT_MUTED = "#898781"

plt.rcParams.update({
    "font.family": "sans-serif",
    "text.color": TEXT,
    "axes.edgecolor": GRID,
    "axes.labelcolor": TEXT,
    "xtick.color": TEXT,
    "ytick.color": TEXT_MUTED,
    "figure.facecolor": "#fcfcfb",
    "axes.facecolor": "#fcfcfb",
    "savefig.facecolor": "#fcfcfb",
})


def load(room_id, suffix, data_dir):
    path = data_dir / f"{room_id}-{suffix}.json"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found — run the corresponding .mjs script for this room first, pointed at this same directory")
    return json.loads(path.read_text())


def chart_actual_vs_optimal(room_id, ova_data, out_dir):
    scoreable = [r for r in ova_data["rounds"] if r.get("optimal")]
    if not scoreable:
        print("No rounds have a valid optimal comparison (every route needs at least one agent) — skipping this chart")
        return

    n = len(scoreable)
    fig, axes = plt.subplots(1, n, figsize=(5 * n, 5), squeeze=False)
    routes = ["Route A", "Route B", "Route C"]
    colors = [COLOR_A, COLOR_B, COLOR_C]

    for i, r in enumerate(scoreable):
        ax = axes[0][i]
        actual_counts = [r["actual"]["counts"][rt] for rt in routes]
        optimal_counts = [r["optimal"]["counts"][rt] for rt in routes]

        x = range(len(routes))
        width = 0.32
        bars_actual = ax.bar([p - width / 2 for p in x], actual_counts, width, label="Actual", color=colors, edgecolor="none")
        bars_optimal = ax.bar([p + width / 2 for p in x], optimal_counts, width, label="Optimal", color=colors, alpha=0.35, edgecolor=COLOR_OPTIMAL, linewidth=1, hatch="///")

        for bar, val in zip(bars_actual, actual_counts):
            ax.text(bar.get_x() + bar.get_width() / 2, val + 0.5, str(val), ha="center", fontsize=10, fontweight="medium")
        for bar, val in zip(bars_optimal, optimal_counts):
            ax.text(bar.get_x() + bar.get_width() / 2, val + 0.5, str(val), ha="center", fontsize=10, color=TEXT_MUTED)

        ax.set_xticks(list(x))
        ax.set_xticklabels(["A", "B", "C"])
        ax.set_ylim(0, 32)
        ax.set_ylabel("Agents" if i == 0 else "")
        ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
        ax.set_axisbelow(True)
        for spine in ["top", "right", "left"]:
            ax.spines[spine].set_visible(False)
        ax.spines["bottom"].set_color(GRID)

        gap_pct = r["gap"]["pct"]
        ax.set_title(f"Round {r['round']}\navg {r['actual']['avgCost']}s vs optimal {r['optimal']['avgCost']}s  (+{gap_pct}%)", fontsize=11)

    handles = [
        plt.Rectangle((0, 0), 1, 1, color="#666666"),
        plt.Rectangle((0, 0), 1, 1, color="#666666", alpha=0.35, hatch="///", edgecolor=COLOR_OPTIMAL),
    ]
    fig.legend(handles, ["Actual", "Optimal"], loc="upper center", ncol=2, frameon=False, bbox_to_anchor=(0.5, 1.06))
    fig.suptitle(f"Room {room_id} — actual vs. system-optimal route distribution", fontsize=14, fontweight="medium", y=1.14)
    fig.tight_layout()

    out_path = out_dir / f"{room_id}-actual-vs-optimal.jpg"
    fig.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved -> {out_path}")


def chart_route_distribution(room_id, analysis_data, out_dir):
    rounds = sorted(analysis_data["distribution_by_round"].keys(), key=int)
    routes = ["Route A", "Route B", "Route C"]
    colors = [COLOR_A, COLOR_B, COLOR_C]

    fig, ax = plt.subplots(figsize=(8, 5))
    x = range(len(rounds))
    width = 0.25

    for i, (route, color) in enumerate(zip(routes, colors)):
        values = [analysis_data["distribution_by_round"][r].get(route, 0) for r in rounds]
        offset = (i - 1) * width
        bars = ax.bar([p + offset for p in x], values, width, label=route, color=color)
        for bar, val in zip(bars, values):
            if val > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, val + 0.4, str(val), ha="center", fontsize=9)

    ax.set_xticks(list(x))
    ax.set_xticklabels([f"Round {r}" for r in rounds])
    ax.set_ylabel("Agents (of 30)")
    ax.set_ylim(0, 33)
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for spine in ["top", "right", "left"]:
        ax.spines[spine].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.legend(frameon=False, loc="upper right")
    ax.set_title(f"Room {room_id} — route choice by round", fontsize=13, fontweight="medium")
    fig.tight_layout()

    out_path = out_dir / f"{room_id}-route-distribution.jpg"
    fig.savefig(out_path, dpi=200, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved -> {out_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/simulated-population/generate-charts.py <room_id> [out_dir]")
        sys.exit(1)

    room_id = sys.argv[1]
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else REPO_ROOT / "data" / "simulated-population"
    out_dir.mkdir(parents=True, exist_ok=True)

    ova_data = load(room_id, "optimal-vs-actual", out_dir)
    analysis_data = load(room_id, "room-analysis", out_dir)

    chart_actual_vs_optimal(room_id, ova_data, out_dir)
    chart_route_distribution(room_id, analysis_data, out_dir)


if __name__ == "__main__":
    main()
