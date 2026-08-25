// Fixed debug panel, only built when the page URL has debug=true.
import type { CellPosition, GameState } from "./Types";

export interface DebugInfo {
  state: GameState;
  fps: number;
  cursor: CellPosition | null;
  selected: CellPosition | null;
  levelId: number | null;
  seed: number | null;
  validMoves: number | null;
  activeGroups: number;
  cascadeIndex: number;
  movesLeft: number;
  score: number;
  showGridCoords: boolean;
  messages: string[];
}

export interface DebugActions {
  toggleGridCoords(): void;
  regenerateBoard(): void;
}

const REFRESH_MS = 200;

export function debugEnabled(search: string = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).get("debug") === "true";
}

function fmt(p: CellPosition | null): string {
  return p ? `${p.row},${p.col}` : "-";
}

export class DebugOverlay {
  readonly root: HTMLElement;
  private readonly rows = new Map<string, HTMLElement>();
  private readonly messages: HTMLElement;
  private readonly gridButton: HTMLButtonElement;
  private lastRefresh = -Infinity;
  private lastLine = "";

  constructor(parent: HTMLElement, actions: DebugActions) {
    const root = document.createElement("aside");
    root.id = "debug";
    root.setAttribute("aria-label", "Debug panel");
    Object.assign(root.style, {
      position: "fixed",
      left: "8px",
      bottom: "8px",
      zIndex: "200",
      width: "15rem",
      maxHeight: "45vh",
      overflow: "auto",
      padding: "6px 8px",
      font: "12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#dff5ea",
      background: "rgba(4, 16, 12, 0.86)",
      border: "1px solid rgba(160, 230, 200, 0.35)",
      borderRadius: "8px",
      pointerEvents: "auto",
    } satisfies Partial<CSSStyleDeclaration>);

    const table = document.createElement("div");
    for (const key of ["state", "fps", "cursor", "selected", "level", "seed", "moves", "score", "valid moves", "groups", "cascade"]) {
      const line = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = `${key}: `;
      label.style.color = "#8fc7b0";
      const value = document.createElement("span");
      line.append(label, value);
      table.appendChild(line);
      this.rows.set(key, value);
    }
    root.appendChild(table);

    this.messages = document.createElement("div");
    this.messages.style.marginTop = "4px";
    this.messages.style.color = "#ffe6a8";
    root.appendChild(this.messages);

    const buttons = document.createElement("div");
    buttons.style.display = "flex";
    buttons.style.gap = "6px";
    buttons.style.marginTop = "6px";
    this.gridButton = this.button("Grid coords", () => actions.toggleGridCoords());
    buttons.append(this.gridButton, this.button("Regenerate board", () => actions.regenerateBoard()));
    root.appendChild(buttons);

    parent.appendChild(root);
    this.root = root;
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    Object.assign(btn.style, {
      font: "inherit",
      padding: "3px 8px",
      color: "inherit",
      background: "rgba(31, 106, 92, 0.6)",
      border: "1px solid rgba(160, 230, 200, 0.4)",
      borderRadius: "6px",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** Refreshes a few times a second; `info` is only called when a refresh is due. */
  update(now: number, info: () => DebugInfo): void {
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const d = info();
    this.setRow("state", d.state);
    this.setRow("fps", d.fps.toFixed(0));
    this.setRow("cursor", fmt(d.cursor));
    this.setRow("selected", fmt(d.selected));
    this.setRow("level", d.levelId === null ? "-" : String(d.levelId));
    this.setRow("seed", d.seed === null ? "-" : String(d.seed));
    this.setRow("moves", String(d.movesLeft));
    this.setRow("score", String(d.score));
    this.setRow("valid moves", d.validMoves === null ? "-" : String(d.validMoves));
    this.setRow("groups", String(d.activeGroups));
    this.setRow("cascade", String(d.cascadeIndex));
    this.gridButton.setAttribute("aria-pressed", String(d.showGridCoords));
    this.gridButton.style.outline = d.showGridCoords ? "2px solid #ffd98a" : "none";
    const line = d.messages.join("\n");
    if (line !== this.lastLine) {
      this.lastLine = line;
      this.messages.replaceChildren(...d.messages.map((m) => Object.assign(document.createElement("div"), { textContent: m })));
    }
  }

  private setRow(key: string, value: string): void {
    const node = this.rows.get(key);
    if (node && node.textContent !== value) node.textContent = value;
  }

  log(...args: unknown[]): void {
    console.log("[gemgarden]", ...args);
  }

  dispose(): void {
    this.root.remove();
  }
}
