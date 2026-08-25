import "./ui/styles.css";
import { Game } from "./game/Game";

function boot(): void {
  const canvas = document.getElementById("board");
  const uiRoot = document.getElementById("ui");
  const fallback = document.getElementById("fallback");
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) throw new Error("Missing #board or #ui");

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) {
    canvas.hidden = true;
    if (fallback) fallback.hidden = false;
    return;
  }

  // Vite HMR re-runs this module; tear the old instance down so listeners and the loop do not double up.
  const w = window as unknown as { gemGarden?: Game };
  w.gemGarden?.destroy();

  const game = new Game(canvas, uiRoot);
  game.start();
  import.meta.hot?.dispose(() => game.destroy());
}

boot();
