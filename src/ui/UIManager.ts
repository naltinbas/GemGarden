// HTML overlays: menus, HUD, dialogs, toasts. No board logic lives here.
import type { LevelDefinition, LevelProgress, LevelResult, ObjectiveStatus, Settings } from "../game/Types";
import { DEFAULT_SETTINGS, TEXT_SCALE, TIMING } from "../game/Config";
import { icon } from "./Icons";

export interface UICallbacks {
  onPlay(): void;
  onContinue(): void;
  onLevelSelect(id: number): void;
  onResume(): void;
  onRestart(): void;
  onNext(): void;
  onMainMenu(): void;
  onLevelSelectScreen(): void;
  onToggleSound(): void;
  onSettingsChange(patch: Partial<Settings>): void;
  onResetProgress(): void;
  onHint(): void;
  /** HUD pause button. When omitted the pause dialog opens directly. */
  onPause?(): void;
  /** Whether the game is paused; a sub-dialog only returns to the pause menu when it is. */
  isPaused?(): boolean;
  /** Optional: the Game can route these to AudioManager.play("uiHover" | "uiSelect"). */
  onUiSound?(name: "uiHover" | "uiSelect"): void;
}

export interface HudUpdate {
  movesLeft: number;
  score: number;
  objectives: ObjectiveStatus[];
  /** Progress between the last reached star threshold and the next (ScoreSystem.progressToNextStar). */
  starFraction: number;
  stars: number;
}

export interface UIOptions {
  /** Element that regains focus when a dialog closes during play; usually the canvas. */
  focusTarget?: HTMLElement;
  lowMovesAt?: number;
}

export type UIScreen = "none" | "menu" | "levelSelect" | "play";
export type UIModal = "pause" | "complete" | "failed" | "controls" | "settings" | "confirmReset" | "credits";

type ReturnTarget = "menu" | "pause" | "levelSelect" | "play";

export const COMPLETE_TITLE = "The garden blooms";
export const FAILED_TITLE = "The garden needs rest";
export const RESHUFFLE_TEXT = "The garden shifts...";

const MAP_WIDTH = 360;
const MAP_ROW_GAP = 104;
const MAP_PAD_Y = 64;
const SCORE_TWEEN_MS = 450;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatScore(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Catmull-Rom through the island centres, emitted as cubic Bezier segments. */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x} ${p2.y}`;
  }
  return d;
}

interface ObjectiveRow {
  root: HTMLLIElement;
  count: HTMLSpanElement;
  key: string;
}

export class UIManager {
  readonly root: HTMLElement;
  private readonly cb: UICallbacks;
  private readonly focusTarget: HTMLElement | null;
  private readonly lowMovesAt: number;

  private settings: Settings = { ...DEFAULT_SETTINGS };
  private screen: UIScreen = "none";
  private activeModal: UIModal | null = null;
  private returnTo: ReturnTarget = "menu";
  private lastFocus: HTMLElement | null = null;

  // Screens
  private readonly menu: HTMLElement;
  private readonly menuContinue: HTMLButtonElement;
  private readonly menuSound: HTMLButtonElement;
  private readonly menuReset: HTMLButtonElement;
  private readonly levelSelect: HTMLElement;
  private readonly islandMap: HTMLElement;

  // HUD
  private readonly hud: HTMLElement;
  private readonly hudLevelNum: HTMLElement;
  private readonly hudLevelName: HTMLElement;
  private readonly hudMoves: HTMLElement;
  private readonly hudMovesValue: HTMLElement;
  private readonly hudScore: HTMLElement;
  private readonly hudScoreValue: HTMLElement;
  private readonly hudObjectives: HTMLUListElement;
  private readonly starFill: HTMLElement;
  private readonly starMarkers: HTMLElement[];
  private readonly cascade: HTMLElement;
  private objectiveRows: ObjectiveRow[] = [];
  private thresholds: [number, number, number] = [1, 2, 3];

  // Score tween
  private scoreShown = 0;
  private scoreFrom = 0;
  private scoreTarget = 0;
  private scoreStart = 0;
  private scoreRaf = 0;

  // Modals
  private readonly modals = new Map<UIModal, HTMLElement>();
  private readonly pauseSound: HTMLButtonElement;
  private readonly completeBody: HTMLElement;
  private readonly completeButtons: HTMLElement;
  private readonly failedBody: HTMLElement;
  private readonly failedTitle: HTMLElement;
  private readonly settingsInputs = new Map<keyof Settings, HTMLInputElement>();
  private readonly textScaleValue: HTMLElement;

  // Transient
  private readonly toastHost: HTMLElement;
  private readonly tutorial: HTMLElement;
  private readonly tutorialText: HTMLElement;
  private readonly intro: HTMLElement;
  private notice: HTMLElement | null = null;
  private noticeTimer = 0;
  private cascadeTimer = 0;
  // Document level so a modal still sees Escape/P when focus sits on <body> or the canvas.
  private readonly onKey = (e: KeyboardEvent): void => this.onKeyDown(e);

  constructor(root: HTMLElement, callbacks: UICallbacks, options: UIOptions = {}) {
    this.root = root;
    this.cb = callbacks;
    this.focusTarget = options.focusTarget ?? null;
    this.lowMovesAt = options.lowMovesAt ?? 5;
    root.classList.add("ui-root");

    // HUD first so the CSS sibling rule for the tutorial banner works.
    const hud = this.buildHud();
    this.hud = hud.root;
    this.hudLevelNum = hud.levelNum;
    this.hudLevelName = hud.levelName;
    this.hudMoves = hud.moves;
    this.hudMovesValue = hud.movesValue;
    this.hudScore = hud.score;
    this.hudScoreValue = hud.scoreValue;
    this.hudObjectives = hud.objectives;
    this.starFill = hud.starFill;
    this.starMarkers = hud.starMarkers;
    this.cascade = hud.cascade;
    root.appendChild(this.hud);

    const menu = this.buildMenu();
    this.menu = menu.root;
    this.menuContinue = menu.continueBtn;
    this.menuSound = menu.soundBtn;
    this.menuReset = menu.resetBtn;
    root.appendChild(this.menu);

    const select = this.buildLevelSelect();
    this.levelSelect = select.root;
    this.islandMap = select.map;
    root.appendChild(this.levelSelect);

    const pause = this.buildPause();
    this.pauseSound = pause.soundBtn;
    const complete = this.buildComplete();
    this.completeBody = complete.body;
    this.completeButtons = complete.buttons;
    const failed = this.buildFailed();
    this.failedBody = failed.body;
    this.failedTitle = failed.title;
    this.buildControls();
    const settings = this.buildSettings();
    this.textScaleValue = settings.textScaleValue;
    this.buildConfirmReset();
    this.buildCredits();

    this.tutorial = el("div", "tutorial panel");
    this.tutorial.setAttribute("role", "status");
    this.tutorial.hidden = true;
    this.tutorial.appendChild(icon("hint", 22));
    this.tutorialText = el("span", "tutorial-text");
    this.tutorial.appendChild(this.tutorialText);
    const dismiss = this.button("", () => this.hideTutorial(), { icon: "close", ghost: true, aria: "Dismiss tip" });
    this.tutorial.appendChild(dismiss);
    root.appendChild(this.tutorial);

    this.intro = el("div", "intro panel");
    this.intro.hidden = true;
    this.intro.setAttribute("aria-live", "polite");
    root.appendChild(this.intro);

    this.toastHost = el("div", "toast-host");
    this.toastHost.setAttribute("aria-live", "polite");
    root.appendChild(this.toastHost);

    document.addEventListener("keydown", this.onKey);
  }

  dispose(): void {
    document.removeEventListener("keydown", this.onKey);
  }

  // ---------------------------------------------------------------------------
  // Public API

  showMainMenu(opts: { hasProgress: boolean }): void {
    this.closeModal();
    this.hideTutorial();
    this.hideIntro();
    this.setScreen("menu");
    this.menuContinue.hidden = !opts.hasProgress;
    this.menuReset.disabled = !opts.hasProgress;
    this.focusFirst(this.menu);
  }

  showLevelSelect(levels: readonly LevelDefinition[], progress: (id: number) => LevelProgress | undefined, highestUnlocked: number): void {
    this.closeModal();
    this.hideTutorial();
    this.hideIntro();
    this.setScreen("levelSelect");
    this.populateIslands(levels, progress, highestUnlocked);
    const current = this.islandMap.querySelector<HTMLElement>(".island.is-current") ?? this.islandMap.querySelector<HTMLElement>(".island");
    if (current) {
      current.scrollIntoView({ block: "center", behavior: this.settings.reducedMotion ? "auto" : "smooth" });
      current.focus({ preventScroll: true });
    } else {
      this.focusFirst(this.levelSelect);
    }
  }

  showHud(level: LevelDefinition): void {
    this.closeModal();
    this.setScreen("play");
    this.hudLevelNum.textContent = `Level ${level.id}`;
    this.hudLevelName.textContent = level.name;
    this.thresholds = level.starThresholds;
    const top = Math.max(1, level.starThresholds[2]);
    for (let i = 0; i < 3; i++) {
      const pct = Math.min(100, (level.starThresholds[i] / top) * 100);
      this.starMarkers[i].style.left = `${pct}%`;
      this.starMarkers[i].classList.remove("is-earned");
      this.starMarkers[i].setAttribute("title", `${i + 1} star${i ? "s" : ""}: ${formatScore(level.starThresholds[i])}`);
    }
    this.starFill.style.width = "0%";
    this.cancelScoreTween();
    this.scoreShown = 0;
    this.scoreTarget = 0;
    this.hudScoreValue.textContent = "0";
    this.hudMovesValue.textContent = String(level.moveLimit);
    this.hudMoves.classList.remove("is-low");
    this.setCascadeLabel("");
    this.objectiveRows = [];
    this.hudObjectives.replaceChildren();
  }

  hideHud(): void {
    this.hud.hidden = true;
    if (this.screen === "play") this.screen = "none";
  }

  updateHud(update: HudUpdate): void {
    this.hudMovesValue.textContent = String(Math.max(0, update.movesLeft));
    this.hudMoves.classList.toggle("is-low", update.movesLeft <= this.lowMovesAt);
    this.hudMoves.setAttribute("aria-label", `${update.movesLeft} moves left`);
    this.setScore(update.score);
    this.renderObjectives(update.objectives);

    const t = this.thresholds;
    const top = Math.max(1, t[2]);
    const stars = Math.max(0, Math.min(3, update.stars));
    let fill: number;
    if (stars >= 3) {
      fill = 1;
    } else {
      const from = stars === 0 ? 0 : t[stars - 1];
      fill = (from + Math.max(0, Math.min(1, update.starFraction)) * (t[stars] - from)) / top;
    }
    this.starFill.style.width = `${Math.max(0, Math.min(100, fill * 100)).toFixed(1)}%`;
    for (let i = 0; i < 3; i++) this.starMarkers[i].classList.toggle("is-earned", stars > i);
    this.starFill.parentElement?.setAttribute("aria-valuenow", String(Math.round(fill * 100)));
  }

  setCascadeLabel(text: string): void {
    window.clearTimeout(this.cascadeTimer);
    if (!text) {
      this.cascade.classList.remove("is-visible");
      this.cascade.textContent = "";
      return;
    }
    this.cascade.textContent = text;
    // Restart the pop animation even when the label is already showing.
    this.cascade.classList.remove("is-visible");
    void this.cascade.offsetWidth;
    this.cascade.classList.add("is-visible");
    this.cascadeTimer = window.setTimeout(() => this.cascade.classList.remove("is-visible"), 1400);
  }

  showPause(): void {
    this.openModal("pause");
  }

  /** Closes the pause menu, or a Controls/Settings/Credits dialog opened from it. */
  hidePause(): void {
    if (this.activeModal === "pause" || (this.isSubDialog() && this.returnTo === "pause")) this.closeModal();
  }

  showLevelComplete(result: LevelResult, hasNext: boolean): void {
    this.hideTutorial();
    this.hideIntro();
    this.completeBody.replaceChildren(
      el("div", "result-level", `Level ${result.levelId} cleared`),
      this.buildStars(result.stars),
      this.buildResultScore(result),
      this.buildResultObjectives(result.objectives),
    );
    const buttons: HTMLElement[] = [];
    if (hasNext) buttons.push(this.button("Next level", () => this.cb.onNext(), { primary: true }));
    buttons.push(this.button("Replay", () => this.cb.onRestart(), { primary: !hasNext }));
    buttons.push(this.button("Level select", () => this.cb.onLevelSelectScreen()));
    buttons.push(this.button("Main menu", () => this.cb.onMainMenu(), { ghost: true }));
    this.completeButtons.replaceChildren(...buttons);
    this.openModal("complete");
  }

  showLevelFailed(result: LevelResult, message: string = FAILED_TITLE): void {
    this.hideTutorial();
    this.hideIntro();
    this.failedTitle.textContent = message;
    const note = el("p", "modal-note", result.movesLeft > 0 ? "No more moves could be found." : "The moves ran out before the goals were met.");
    this.failedBody.replaceChildren(
      el("div", "result-level", `Level ${result.levelId}`),
      note,
      this.buildResultScore(result),
      this.buildResultObjectives(result.objectives),
    );
    this.openModal("failed");
  }

  showControls(): void {
    this.rememberOrigin();
    this.openModal("controls");
  }

  showSettings(settings: Settings = this.settings): void {
    this.settings = { ...settings };
    this.syncSettingsInputs();
    this.rememberOrigin();
    this.openModal("settings");
  }

  showCredits(): void {
    this.rememberOrigin();
    this.openModal("credits");
  }

  /** Hides every dialog and transient element. The HUD stays as it is. */
  hideOverlays(): void {
    this.closeModal();
    this.hideIntro();
    this.hideNotice();
    if (this.screen === "menu" || this.screen === "levelSelect") this.setScreen("none");
  }

  toast(text: string, ms: number = TIMING.toast): void {
    const node = el("div", "toast", text);
    this.toastHost.appendChild(node);
    while (this.toastHost.childElementCount > 3) this.toastHost.firstElementChild?.remove();
    window.setTimeout(() => {
      node.classList.add("is-leaving");
      window.setTimeout(() => node.remove(), this.settings.reducedMotion ? 0 : 420);
    }, ms);
  }

  showTutorial(text: string): void {
    this.tutorialText.textContent = text;
    this.tutorial.hidden = false;
  }

  hideTutorial(): void {
    const hadFocus = this.tutorial.contains(document.activeElement);
    this.tutorial.hidden = true;
    if (hadFocus) this.focusTarget?.focus({ preventScroll: true });
  }

  /** Level name and goals splash; stays until hideIntro/hideOverlays. Does not take focus. */
  showLevelIntro(level: LevelDefinition, objectives: ObjectiveStatus[] = []): void {
    const list = el("ul", "intro-objectives");
    for (const o of objectives) list.appendChild(this.objectiveChip(o, false));
    const children: HTMLElement[] = [
      el("div", "result-level", `Level ${level.id}`),
      el("h2", undefined, level.name),
    ];
    if (level.flavor) children.push(el("p", "intro-flavor", level.flavor));
    if (objectives.length) children.push(list);
    children.push(el("p", "intro-continue", `${level.moveLimit} moves`));
    this.intro.replaceChildren(...children);
    this.intro.hidden = false;
  }

  hideIntro(): void {
    this.intro.hidden = true;
  }

  /** Centre-screen shimmer used for reshuffles. */
  showNotice(text: string = RESHUFFLE_TEXT, ms: number = TIMING.reshuffle + 900): void {
    this.hideNotice();
    const node = el("div", "notice", text);
    node.setAttribute("role", "status");
    this.root.appendChild(node);
    this.notice = node;
    this.noticeTimer = window.setTimeout(() => this.hideNotice(), ms);
  }

  hideNotice(): void {
    window.clearTimeout(this.noticeTimer);
    this.notice?.remove();
    this.notice = null;
  }

  /** Mirrors settings onto <html> so CSS can react, and refreshes the settings form. */
  applySettings(settings: Settings): void {
    this.settings = { ...settings };
    const html = document.documentElement;
    html.dataset.highContrast = String(settings.highContrast);
    html.dataset.reducedMotion = String(settings.reducedMotion);
    html.style.setProperty("--text-scale", String(settings.textScale));
    this.setSoundIcon(settings.sound);
    this.syncSettingsInputs();
  }

  setSoundIcon(on: boolean): void {
    for (const btn of [this.menuSound, this.pauseSound]) {
      btn.replaceChildren(icon(on ? "soundOn" : "soundOff", 22), el("span", undefined, on ? "Sound on" : "Sound off"));
      btn.setAttribute("aria-pressed", String(on));
    }
  }

  get currentScreen(): UIScreen {
    return this.screen;
  }

  get currentModal(): UIModal | null {
    return this.activeModal;
  }

  // ---------------------------------------------------------------------------
  // Builders

  private button(
    label: string,
    onClick: () => void,
    opts: { primary?: boolean; ghost?: boolean; danger?: boolean; icon?: string; aria?: string } = {},
  ): HTMLButtonElement {
    const btn = el("button", "btn");
    btn.type = "button";
    if (opts.primary) btn.classList.add("btn--primary");
    if (opts.ghost) btn.classList.add("btn--ghost");
    if (opts.danger) btn.classList.add("btn--danger");
    if (opts.icon) {
      btn.appendChild(icon(opts.icon, 22));
      if (!label) btn.classList.add("btn--icon");
    }
    if (label) btn.appendChild(el("span", undefined, label));
    if (opts.aria) btn.setAttribute("aria-label", opts.aria);
    btn.addEventListener("click", () => {
      this.cb.onUiSound?.("uiSelect");
      onClick();
    });
    btn.addEventListener("pointerenter", () => this.cb.onUiSound?.("uiHover"));
    return btn;
  }

  private buildHud() {
    const root = el("header", "hud");
    root.hidden = true;
    root.setAttribute("aria-label", "Game status");

    const left = el("div", "hud-group hud-left");
    left.appendChild(this.button("", () => (this.cb.onPause ? this.cb.onPause() : this.showPause()), { icon: "pause", aria: "Pause" }));
    const level = el("div", "hud-level");
    const levelNum = el("span", "hud-level-num");
    const levelName = el("span", "hud-level-name");
    level.append(levelNum, levelName);
    left.appendChild(level);

    const stats = el("div", "hud-group hud-stats");
    const moves = el("div", "hud-stat hud-moves");
    moves.append(el("span", "hud-stat-label", "Moves"));
    const movesValue = el("span", "hud-stat-value", "0");
    moves.appendChild(movesValue);
    const score = el("div", "hud-stat hud-score");
    score.append(el("span", "hud-stat-label", "Score"));
    const scoreValue = el("span", "hud-stat-value", "0");
    score.appendChild(scoreValue);
    stats.append(moves, score);

    const objectives = el("ul", "hud-objectives");
    objectives.setAttribute("aria-label", "Goals");

    const right = el("div", "hud-group hud-right");
    const starbar = el("div", "starbar");
    starbar.setAttribute("role", "progressbar");
    starbar.setAttribute("aria-label", "Star progress");
    starbar.setAttribute("aria-valuemin", "0");
    starbar.setAttribute("aria-valuemax", "100");
    starbar.setAttribute("aria-valuenow", "0");
    const starFill = el("div", "starbar-fill");
    starbar.appendChild(starFill);
    const starMarkers: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      const marker = el("span", "starbar-marker");
      marker.appendChild(icon("star", 20));
      starbar.appendChild(marker);
      starMarkers.push(marker);
    }
    right.appendChild(starbar);
    const hint = this.button("", () => this.cb.onHint(), { icon: "hint", aria: "Show a hint" });
    hint.classList.add("hud-hint");
    right.appendChild(hint);

    const cascade = el("div", "hud-cascade");
    cascade.setAttribute("aria-live", "polite");

    root.append(left, stats, objectives, right, cascade);
    return { root, levelNum, levelName, moves, movesValue, score, scoreValue, objectives, starFill, starMarkers, cascade };
  }

  private buildMenu() {
    const root = el("section", "screen");
    root.hidden = true;
    root.setAttribute("aria-label", "Main menu");
    const panel = el("div", "menu panel");
    panel.appendChild(el("div", "menu-lantern"));
    const title = el("h1", "menu-title", "Gem Garden");
    title.appendChild(el("small", undefined, "a night in the greenhouse"));
    panel.appendChild(title);

    const col = el("div", "btn-col");
    const continueBtn = this.button("Continue", () => this.cb.onContinue(), { primary: true });
    col.appendChild(continueBtn);
    col.appendChild(this.button("Play", () => this.cb.onPlay(), { primary: true }));
    col.appendChild(this.button("Level select", () => this.cb.onLevelSelectScreen()));
    col.appendChild(this.button("Controls", () => this.showControls()));
    const row = el("div", "menu-row");
    const soundBtn = this.button("Sound on", () => this.cb.onToggleSound(), { icon: "soundOn" });
    row.appendChild(soundBtn);
    row.appendChild(this.button("Settings", () => this.showSettings()));
    col.appendChild(row);
    const resetBtn = this.button("Reset progress", () => this.openConfirmReset(), { ghost: true, danger: true });
    col.appendChild(resetBtn);
    col.appendChild(this.button("Credits", () => this.showCredits(), { ghost: true }));
    panel.appendChild(col);
    panel.appendChild(el("p", "menu-footer", "Match three, grow specials, tend the beds."));
    root.appendChild(panel);
    return { root, continueBtn, soundBtn, resetBtn };
  }

  private buildLevelSelect() {
    const root = el("section", "screen");
    root.hidden = true;
    root.setAttribute("aria-label", "Level select");
    const panel = el("div", "level-select panel");
    const head = el("div", "level-select-head");
    head.appendChild(this.button("", () => this.cb.onMainMenu(), { icon: "back", ghost: true, aria: "Back to main menu" }));
    head.appendChild(el("h2", undefined, "Garden Path"));
    const spacer = el("span");
    spacer.style.width = "var(--tap)";
    head.appendChild(spacer);
    panel.appendChild(head);
    const map = el("div", "island-map");
    map.setAttribute("aria-label", "Levels");
    panel.appendChild(map);
    root.appendChild(panel);
    return { root, map };
  }

  private populateIslands(levels: readonly LevelDefinition[], progress: (id: number) => LevelProgress | undefined, highestUnlocked: number): void {
    const n = levels.length;
    const height = MAP_PAD_Y * 2 + Math.max(0, n - 1) * MAP_ROW_GAP;
    const field = el("div", "island-field");
    field.style.aspectRatio = `${MAP_WIDTH} / ${height}`;

    const points = levels.map((_, i) => ({
      x: Math.round(MAP_WIDTH / 2 + MAP_WIDTH * 0.3 * Math.sin(i * 1.15 + 0.6)),
      y: MAP_PAD_Y + i * MAP_ROW_GAP,
    }));

    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("class", "island-path");
    svg.setAttribute("viewBox", `0 0 ${MAP_WIDTH} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    const d = smoothPath(points);
    const glow = document.createElementNS(svgNs, "path");
    glow.setAttribute("class", "island-path-glow");
    glow.setAttribute("d", d);
    const line = document.createElementNS(svgNs, "path");
    line.setAttribute("d", d);
    svg.append(glow, line);
    field.appendChild(svg);

    const lastId = levels[n - 1]?.id ?? 1;
    const currentId = Math.min(highestUnlocked, lastId);
    levels.forEach((level, i) => {
      const p = progress(level.id);
      const unlocked = level.id <= highestUnlocked;
      const stars = p?.stars ?? 0;
      const btn = el("button", "island");
      btn.type = "button";
      btn.style.left = `${((points[i].x / MAP_WIDTH) * 100).toFixed(2)}%`;
      btn.style.top = `${((points[i].y / height) * 100).toFixed(2)}%`;
      btn.dataset.levelId = String(level.id);
      if (!unlocked) btn.classList.add("is-locked");
      if (p?.completed) btn.classList.add("is-done");
      if (level.id === currentId) btn.classList.add("is-current");

      if (unlocked) {
        btn.appendChild(el("span", "island-num", String(level.id)));
        const starRow = el("span", "island-stars");
        for (let s = 0; s < 3; s++) {
          const star = icon("star", 12);
          if (s < stars) star.classList.add("is-earned");
          starRow.appendChild(star);
        }
        btn.appendChild(starRow);
      } else {
        btn.appendChild(icon("lock", 24));
        btn.appendChild(el("span", "island-num", String(level.id)));
      }
      btn.appendChild(el("span", "island-name", level.name));
      const state = unlocked ? `${stars} of 3 stars` : "locked";
      btn.setAttribute("aria-label", `Level ${level.id}, ${level.name}, ${state}`);
      if (unlocked) {
        btn.addEventListener("click", () => {
          this.cb.onUiSound?.("uiSelect");
          this.cb.onLevelSelect(level.id);
        });
        btn.addEventListener("pointerenter", () => this.cb.onUiSound?.("uiHover"));
      } else {
        btn.setAttribute("aria-disabled", "true");
        btn.addEventListener("click", () => this.toast("Finish the level before this one first."));
      }
      field.appendChild(btn);
    });
    this.islandMap.replaceChildren(field);
  }

  private modal(name: UIModal, titleText: string, wide = false): { panel: HTMLElement; body: HTMLElement; title: HTMLElement } {
    const backdrop = el("div", "modal-backdrop");
    backdrop.hidden = true;
    const panel = el("div", wide ? "modal modal--wide panel" : "modal panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    const titleId = `dlg-${name}-title`;
    panel.setAttribute("aria-labelledby", titleId);
    const title = el("h2", undefined, titleText);
    title.id = titleId;
    const body = el("div", "modal-body");
    panel.append(title, body);
    backdrop.appendChild(panel);
    this.root.appendChild(backdrop);
    this.modals.set(name, backdrop);
    return { panel, body, title };
  }

  private buildPause() {
    const { panel } = this.modal("pause", "Paused");
    const col = el("div", "btn-col");
    col.appendChild(this.button("Resume", () => this.cb.onResume(), { primary: true }));
    col.appendChild(this.button("Restart level", () => this.cb.onRestart()));
    col.appendChild(this.button("Controls", () => this.showControls()));
    const row = el("div", "menu-row");
    const soundBtn = this.button("Sound on", () => this.cb.onToggleSound(), { icon: "soundOn" });
    row.appendChild(soundBtn);
    row.appendChild(this.button("Settings", () => this.showSettings()));
    col.appendChild(row);
    col.appendChild(this.button("Level select", () => this.cb.onLevelSelectScreen(), { ghost: true }));
    col.appendChild(this.button("Main menu", () => this.cb.onMainMenu(), { ghost: true }));
    panel.appendChild(col);
    return { soundBtn };
  }

  private buildComplete() {
    const { panel, body } = this.modal("complete", COMPLETE_TITLE);
    const buttons = el("div", "btn-col");
    panel.appendChild(buttons);
    return { body, buttons };
  }

  private buildFailed() {
    const { panel, body, title } = this.modal("failed", FAILED_TITLE);
    const col = el("div", "btn-col");
    col.appendChild(this.button("Try again", () => this.cb.onRestart(), { primary: true }));
    col.appendChild(this.button("Level select", () => this.cb.onLevelSelectScreen()));
    col.appendChild(this.button("Main menu", () => this.cb.onMainMenu(), { ghost: true }));
    panel.appendChild(col);
    return { body, title };
  }

  private buildControls(): void {
    const { panel, body } = this.modal("controls", "Controls", true);
    const table = el("table", "key-table");
    const rows: [string[], string][] = [
      [["Arrow keys", "W A S D"], "Move the cursor"],
      [["Space", "Enter"], "Select a gem, then confirm a swap with a neighbour"],
      [["Esc", "P"], "Pause or resume"],
      [["R"], "Restart the level"],
      [["H"], "Show a hint"],
      [["Tab"], "Move between buttons in menus"],
    ];
    const tbody = el("tbody");
    for (const [keys, desc] of rows) {
      const tr = el("tr");
      const th = el("th");
      th.scope = "row";
      keys.forEach((k, i) => {
        if (i > 0) th.appendChild(document.createTextNode(" / "));
        th.appendChild(el("kbd", undefined, k));
      });
      tr.append(th, el("td", undefined, desc));
      tbody.appendChild(tr);
    }
    const mouse = el("tr");
    const mouseTh = el("th", undefined, "Mouse / touch");
    mouseTh.scope = "row";
    mouse.append(mouseTh, el("td", undefined, "Tap a gem then tap a neighbour, or drag a gem toward a neighbour."));
    tbody.appendChild(mouse);
    table.appendChild(tbody);
    body.appendChild(table);
    panel.appendChild(this.button("Back", () => this.goBack(), { primary: true }));
  }

  private buildSettings() {
    const { panel, body } = this.modal("settings", "Settings", true);
    const list = el("div", "settings-list");
    const toggles: [keyof Settings, string, string][] = [
      ["sound", "Sound effects", "Short synthesised sounds for matches and menus"],
      ["ambient", "Ambient pad", "A soft drone while you play"],
      ["hints", "Hints", "Highlight a move after a pause"],
      ["highContrast", "High contrast", "Solid panels, thick outlines, letters on gems"],
      ["reducedMotion", "Reduced motion", "Shorter animations, no idle effects"],
      ["showGridCoords", "Show grid coordinates", "Row and column labels around the board"],
    ];
    for (const [key, label, hint] of toggles) {
      const row = el("label", "setting");
      const text = el("span", "setting-text");
      text.append(el("span", undefined, label), el("span", "setting-hint", hint));
      const input = el("input", "switch");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.addEventListener("change", () => {
        this.settings = { ...this.settings, [key]: input.checked };
        this.cb.onUiSound?.("uiSelect");
        this.cb.onSettingsChange({ [key]: input.checked } as Partial<Settings>);
      });
      this.settingsInputs.set(key, input);
      row.append(text, input);
      list.appendChild(row);
    }

    const scaleRow = el("label", "setting");
    const scaleText = el("span", "setting-text");
    scaleText.append(el("span", undefined, "Text size"), el("span", "setting-hint", "Scales every menu and the HUD"));
    const wrap = el("span", "range-wrap");
    const range = el("input");
    range.type = "range";
    range.min = String(TEXT_SCALE.min);
    range.max = String(TEXT_SCALE.max);
    range.step = String(TEXT_SCALE.step);
    range.setAttribute("aria-label", "Text size");
    const textScaleValue = el("span", "range-value", "100%");
    range.addEventListener("input", () => {
      const value = Number(range.value);
      textScaleValue.textContent = `${Math.round(value * 100)}%`;
    });
    range.addEventListener("change", () => {
      const value = Number(range.value);
      this.settings = { ...this.settings, textScale: value };
      this.cb.onSettingsChange({ textScale: value });
    });
    this.settingsInputs.set("textScale", range);
    wrap.append(range, textScaleValue);
    scaleRow.append(scaleText, wrap);
    list.appendChild(scaleRow);

    body.appendChild(list);
    panel.appendChild(this.button("Back", () => this.goBack(), { primary: true }));
    return { textScaleValue };
  }

  private buildConfirmReset(): void {
    const { panel, body } = this.modal("confirmReset", "Reset progress?");
    body.appendChild(el("p", "modal-note", "All stars and best scores will be cleared. Settings are kept."));
    const row = el("div", "btn-row");
    row.appendChild(this.button("Keep it", () => this.cancelConfirmReset(), { primary: true }));
    row.appendChild(
      this.button(
        "Reset",
        () => {
          this.closeModal();
          this.cb.onResetProgress();
        },
        { danger: true },
      ),
    );
    panel.appendChild(row);
  }

  private buildCredits(): void {
    const { panel, body } = this.modal("credits", "Credits");
    const list = el("div", "credits-list");
    list.append(
      el("p", undefined, "Gem Garden is an original match-3 puzzle set in a night greenhouse."),
      el("p", undefined, "Built with TypeScript, Vite and the Canvas 2D API."),
      el("p", undefined, "Every gem, blocker and sound is drawn or synthesised in code, without any external assets."),
    );
    body.appendChild(list);
    panel.appendChild(this.button("Back", () => this.goBack(), { primary: true }));
  }

  private buildStars(stars: number): HTMLElement {
    const row = el("div", "result-stars");
    row.setAttribute("role", "img");
    row.setAttribute("aria-label", `${stars} of 3 stars`);
    for (let i = 0; i < 3; i++) {
      const star = icon("star", 52);
      if (i < stars) star.classList.add("is-earned");
      row.appendChild(star);
    }
    return row;
  }

  private buildResultScore(result: LevelResult): HTMLElement {
    const wrap = el("div", "result-score");
    wrap.appendChild(el("span", "result-score-value", formatScore(result.score)));
    const sub = el("span", "result-score-sub");
    if (result.isNewBest && result.won) {
      sub.textContent = "New best score";
      sub.classList.add("is-best");
    } else {
      sub.textContent = `Best ${formatScore(result.bestScore)}`;
    }
    wrap.appendChild(sub);
    if (result.won && result.movesLeft > 0) {
      wrap.appendChild(el("span", "result-score-sub", `${result.movesLeft} moves to spare`));
    }
    return wrap;
  }

  private buildResultObjectives(objectives: ObjectiveStatus[]): HTMLElement {
    const list = el("ul", "result-objectives");
    for (const o of objectives) list.appendChild(this.objectiveChip(o, true));
    return list;
  }

  private objectiveChip(o: ObjectiveStatus, withCount: boolean): HTMLLIElement {
    const li = el("li", "objective");
    if (o.complete) li.classList.add("is-complete");
    li.appendChild(icon(o.icon, 20));
    li.appendChild(el("span", "objective-label", o.label));
    const count = el("span", "objective-count", withCount ? `${formatScore(o.progress)} / ${formatScore(o.target)}` : formatScore(o.target));
    li.appendChild(count);
    li.appendChild(icon("check", 16));
    return li;
  }

  private renderObjectives(objectives: ObjectiveStatus[]): void {
    const keys = objectives.map((o) => `${o.type}|${o.icon}|${o.label}`);
    const same = keys.length === this.objectiveRows.length && keys.every((k, i) => this.objectiveRows[i].key === k);
    if (!same) {
      this.objectiveRows = objectives.map((o, i) => {
        const root = this.objectiveChip(o, true);
        root.setAttribute("aria-label", `${o.label}: ${o.progress} of ${o.target}${o.complete ? ", done" : ""}`);
        return { root, count: root.querySelector<HTMLSpanElement>(".objective-count")!, key: keys[i] };
      });
      this.hudObjectives.replaceChildren(...this.objectiveRows.map((r) => r.root));
      return;
    }
    objectives.forEach((o, i) => {
      const row = this.objectiveRows[i];
      const text = `${formatScore(o.progress)} / ${formatScore(o.target)}`;
      if (row.count.textContent !== text) row.count.textContent = text;
      row.root.classList.toggle("is-complete", o.complete);
      row.root.setAttribute("aria-label", `${o.label}: ${o.progress} of ${o.target}${o.complete ? ", done" : ""}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Score count-up

  private setScore(target: number): void {
    if (target === this.scoreTarget) return;
    this.scoreTarget = target;
    if (this.settings.reducedMotion || target < this.scoreShown) {
      this.cancelScoreTween();
      this.scoreShown = target;
      this.hudScoreValue.textContent = formatScore(target);
      return;
    }
    this.scoreFrom = this.scoreShown;
    this.scoreStart = performance.now();
    this.hudScore.classList.add("is-bumping");
    if (!this.scoreRaf) this.scoreRaf = requestAnimationFrame((t) => this.tickScore(t));
  }

  private tickScore(now: number): void {
    const t = Math.min(1, (now - this.scoreStart) / SCORE_TWEEN_MS);
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    this.scoreShown = this.scoreFrom + (this.scoreTarget - this.scoreFrom) * eased;
    this.hudScoreValue.textContent = formatScore(this.scoreShown);
    if (t < 1) {
      this.scoreRaf = requestAnimationFrame((next) => this.tickScore(next));
    } else {
      this.scoreRaf = 0;
      this.scoreShown = this.scoreTarget;
      this.hudScore.classList.remove("is-bumping");
    }
  }

  private cancelScoreTween(): void {
    if (this.scoreRaf) cancelAnimationFrame(this.scoreRaf);
    this.scoreRaf = 0;
    this.hudScore.classList.remove("is-bumping");
  }

  // ---------------------------------------------------------------------------
  // Screen and modal plumbing

  private setScreen(screen: UIScreen): void {
    this.screen = screen;
    this.menu.hidden = screen !== "menu";
    this.levelSelect.hidden = screen !== "levelSelect";
    this.hud.hidden = screen !== "play";
  }

  private rememberOrigin(): void {
    if (this.activeModal === "pause") this.returnTo = "pause";
    else if (this.activeModal === "controls" || this.activeModal === "settings" || this.activeModal === "credits") return;
    else if (this.screen === "levelSelect") this.returnTo = "levelSelect";
    else if (this.screen === "play") this.returnTo = "play";
    else this.returnTo = "menu";
  }

  private goBack(): void {
    const to = this.returnTo;
    this.closeModal();
    if (to === "pause") {
      if (this.cb.isPaused?.() ?? true) this.showPause();
      else this.focusTarget?.focus({ preventScroll: true });
    } else if (to === "levelSelect") this.cb.onLevelSelectScreen();
    else if (to === "play") this.focusTarget?.focus({ preventScroll: true });
    else this.cb.onMainMenu();
  }

  private openConfirmReset(): void {
    this.openModal("confirmReset");
  }

  private cancelConfirmReset(): void {
    this.closeModal();
    this.menuReset.focus({ preventScroll: true });
  }

  private openModal(name: UIModal): void {
    const target = this.modals.get(name);
    if (!target) return;
    if (this.activeModal === null) {
      const active = document.activeElement;
      this.lastFocus = active instanceof HTMLElement && !this.isInModal(active) ? active : null;
    }
    for (const [key, node] of this.modals) node.hidden = key !== name;
    this.activeModal = name;
    this.focusFirst(target);
  }

  private closeModal(): void {
    if (this.activeModal === null) return;
    const active = document.activeElement;
    for (const node of this.modals.values()) node.hidden = true;
    this.activeModal = null;
    if (active instanceof HTMLElement && this.isInModal(active)) {
      const back = this.lastFocus && this.lastFocus.isConnected && !this.lastFocus.hidden ? this.lastFocus : this.focusTarget;
      back?.focus({ preventScroll: true });
    }
    this.lastFocus = null;
  }

  private isSubDialog(): boolean {
    return this.activeModal === "controls" || this.activeModal === "settings" || this.activeModal === "credits";
  }

  private isInModal(node: Element): boolean {
    for (const modal of this.modals.values()) if (modal.contains(node)) return true;
    return false;
  }

  private focusFirst(container: HTMLElement): void {
    // Skip hidden candidates such as the Continue button when there is no progress.
    const first = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).find((n) => n.offsetParent !== null);
    first?.focus({ preventScroll: true });
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Tab" && this.activeModal !== null) {
      this.trapTab(e);
      return;
    }
    if (e.key !== "Escape") {
      // P toggles only from the pause menu itself; any other dialog swallows it so play cannot resume underneath.
      if ((e.key === "p" || e.key === "P") && this.activeModal !== null) {
        e.preventDefault();
        if (this.activeModal === "pause") this.cb.onResume();
      }
      return;
    }
    switch (this.activeModal) {
      case "pause":
        e.preventDefault();
        this.cb.onResume();
        return;
      case "controls":
      case "settings":
      case "credits":
        e.preventDefault();
        this.goBack();
        return;
      case "confirmReset":
        e.preventDefault();
        this.cancelConfirmReset();
        return;
      case "complete":
      case "failed":
        e.preventDefault();
        return;
      case null:
        if (this.screen === "levelSelect") {
          e.preventDefault();
          this.cb.onMainMenu();
        } else if (!this.tutorial.hidden && this.tutorial.contains(e.target as Node)) {
          e.preventDefault();
          this.hideTutorial();
        }
        return;
    }
  }

  private trapTab(e: KeyboardEvent): void {
    const modal = this.activeModal ? this.modals.get(this.activeModal) : null;
    if (!modal) return;
    const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !modal.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  private syncSettingsInputs(): void {
    for (const [key, input] of this.settingsInputs) {
      if (key === "textScale") {
        input.value = String(this.settings.textScale);
        this.textScaleValue.textContent = `${Math.round(this.settings.textScale * 100)}%`;
      } else {
        input.checked = this.settings[key] === true;
      }
    }
  }
}
