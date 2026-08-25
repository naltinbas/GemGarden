// Game orchestration: state machine, level flow, animation sequencing, input wiring.
import type {
  BlockerType,
  CellPosition,
  ClearStep,
  FallStep,
  LevelDefinition,
  LevelResult,
  ObjectiveStatus,
  Settings,
  SpecialActivation,
  SpreadEvent,
} from "./Types";
import { SCORE, SPECIAL_NAMES, TIMING, TOKEN_STYLE, cascadeLabel } from "./Config";
import { Board } from "../board/Board";
import { columnSegments } from "../board/GravitySystem";
import { findMatches } from "../board/MatchFinder";
import { findValidMoves, hasValidMove, type Move } from "../board/MoveValidator";
import { reshuffle } from "../board/ReshuffleSystem";
import { RoundResolver } from "../board/RoundResolver";
import { LevelRepository, levelRepository } from "../levels/LevelRepository";
import { ObjectiveTracker } from "../objectives/ObjectiveTracker";
import { CanvasRenderer, tokenParticleColors } from "../render/CanvasRenderer";
import { EffectsRenderer } from "../render/EffectsRenderer";
import type { GhostToken, RenderFrame, RenderSettings } from "../render/RenderFrame";
import { AnimationSystem, linear, type Easing } from "../systems/AnimationSystem";
import { HintSystem, type Hint } from "../systems/HintSystem";
import { ParticleSystem } from "../systems/ParticleSystem";
import { ScoreSystem } from "../systems/ScoreSystem";
import { RESHUFFLE_TEXT, UIManager } from "../ui/UIManager";
import { Random } from "../utils/Random";
import { clamp, easeInOutQuad, easeInQuad, easeOutBack, easeOutCubic } from "../utils/MathUtils";
import { AudioManager } from "./AudioManager";
import { DebugOverlay, debugEnabled, type DebugInfo } from "./DebugOverlay";
import { StateMachine, type GameState } from "./GameState";
import { InputManager } from "./InputManager";
import { SaveManager } from "./SaveManager";

export const STILL_MESSAGE = "The garden has gone still.";

const BLOCKER_PARTICLE: Record<BlockerType, string[]> = {
  stoneRoot: ["#a8a8a8", "#6f6f6f", "#d6d6d6"],
  glassVine: ["#bfe9ff", "#ffffff", "#7fc8ff"],
  lockedBud: ["#f3a5c8", "#ff7aa8", "#ffe0ec"],
  shadowMist: ["#7a5cc7", "#b79cff", "#3a2b66"],
};
const MOSS_PARTICLE = ["#6ff0a0", "#2ebd6b", "#c9ffd9"];
const SEED_PARTICLE = ["#ffd77a", "#ffb347", "#fff3c0"];

/** Thrown through the async move flow when the level it belongs to was left. */
const ABORT = Symbol("level aborted");

function samePos(a: CellPosition, b: CellPosition): boolean {
  return a.row === b.row && a.col === b.col;
}

function adjacent(a: CellPosition, b: CellPosition): boolean {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

/** Accelerating drop with a small overshoot past the cell, capped so long falls do not bounce wildly. */
function fallEasing(distance: number): Easing {
  const over = Math.min(0.12, 0.06 * Math.max(1, distance)) / Math.max(1, distance);
  const split = 0.82;
  return (t) => {
    if (t < split) {
      const u = t / split;
      return u * u * (1 + over);
    }
    const u = (t - split) / (1 - split);
    return 1 + over - over * easeOutCubic(u);
  };
}

export interface GameOptions {
  levels?: LevelRepository;
  debug?: boolean;
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: CanvasRenderer;
  readonly effects = new EffectsRenderer();
  readonly particles = new ParticleSystem(700);
  readonly animations = new AnimationSystem();
  readonly hint = new HintSystem();
  readonly audio = new AudioManager();
  readonly save: SaveManager;
  readonly ui: UIManager;
  readonly input: InputManager;
  readonly levels: LevelRepository;
  readonly debug: DebugOverlay | null;

  private readonly fsm: StateMachine;
  private readonly stage: HTMLElement;
  private settings: Settings;
  private readonly renderSettings: RenderSettings = { highContrast: false, reducedMotion: false, showGridCoords: false };

  private board: Board;
  private level: LevelDefinition | null = null;
  private resolver: RoundResolver | null = null;
  private tracker: ObjectiveTracker | null = null;
  private readonly scoring = new ScoreSystem();
  private movesLeft = 0;
  private delivered = 0;
  private cascadeIndex = 0;
  private activeGroups = 0;
  private tutorialShown = false;

  private selected: CellPosition | null = null;
  private hover: CellPosition | null = null;
  private cursorVisible = false;
  private readonly ghosts: GhostToken[] = [];
  private shake = 0;

  private speed = 1;
  private time = 0;
  private lastFrame = -1;
  private rafId = 0;
  private running = false;
  private clockPaused = false;
  private resumeState: GameState = "PLAYER_INPUT";
  private fps = 60;
  private lastDpr = 0;
  private session = 0;
  private introSkip: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private readonly frame: RenderFrame;
  private readonly onWindowResize = (): void => this.resize();
  private readonly onVisibility = (): void => {
    // Skip the time that passed while hidden; the next frame starts a fresh delta.
    this.lastFrame = -1;
    if (document.visibilityState === "visible") this.audio.resume();
  };
  // Stays registered for the game's lifetime: the context can be suspended again after the first unlock.
  private readonly unlockAudio = (): void => this.audio.unlock();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, options: GameOptions = {}) {
    this.canvas = canvas;
    this.stage = canvas.parentElement ?? document.body;
    this.levels = options.levels ?? levelRepository;
    this.renderer = new CanvasRenderer(canvas);
    this.save = new SaveManager();
    this.settings = this.save.settings;
    this.fsm = new StateMachine("MAIN_MENU", (from, to) => {
      if (this.debug) console.error(`[gemgarden] invalid state transition ${from} -> ${to}`);
    });
    this.board = this.backgroundBoard();

    this.ui = new UIManager(
      uiRoot,
      {
        onPlay: () => void this.startLevel(this.levels.first().id),
        onContinue: () => void this.startLevel(Math.min(this.save.highestUnlocked, this.levels.count)),
        onLevelSelect: (id) => void this.startLevel(id),
        onResume: () => this.resume(),
        onRestart: () => this.restart(),
        onNext: () => this.nextLevel(),
        onMainMenu: () => this.showMainMenu(),
        onLevelSelectScreen: () => this.showLevelSelect(),
        onToggleSound: () => this.applySettings(this.save.updateSettings({ sound: !this.settings.sound })),
        onSettingsChange: (patch) => this.applySettings(this.save.updateSettings(patch)),
        onResetProgress: () => {
          this.save.reset();
          this.applySettings(this.save.settings);
          this.showMainMenu();
        },
        onHint: () => this.showHint(),
        onPause: () => this.pause(),
        onUiSound: (name) => this.audio.play(name),
      },
      { focusTarget: canvas },
    );

    this.input = new InputManager(canvas, {
      xyToCell: (x, y) => this.renderer.xyToCell(x, y),
      cellSize: () => this.renderer.layout.cellSize,
    });
    this.input.on("select", (pos) => this.onSelect(pos));
    this.input.on("swap", ({ a, b }) => this.onSwapIntent(a, b));
    this.input.on("cursorMove", () => {
      this.cursorVisible = true;
      this.hint.onInput();
    });
    this.input.on("hover", (pos) => {
      this.hover = pos;
      if (pos) this.cursorVisible = false;
    });
    this.input.on("pause", () => this.togglePause());
    this.input.on("restart", () => this.restart());
    this.input.on("hint", () => this.showHint());
    this.input.on("activity", () => this.skipIntro());

    const debug = options.debug ?? debugEnabled();
    this.debug = debug
      ? new DebugOverlay(document.body, {
          toggleGridCoords: () => this.applySettings(this.save.updateSettings({ showGridCoords: !this.settings.showGridCoords })),
          regenerateBoard: () => this.regenerateBoard(),
        })
      : null;

    this.frame = {
      board: this.board,
      visuals: this.animations,
      particles: this.particles,
      effects: this.effects,
      selected: null,
      cursor: null,
      cursorVisible: false,
      hover: null,
      hint: null,
      ghosts: this.ghosts,
      shake: 0,
      time: 0,
      settings: this.renderSettings,
      dimmed: true,
    };
    this.applySettings(this.settings);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle

  start(): void {
    if (this.running) return;
    this.running = true;
    (window as unknown as { gemGarden?: Game }).gemGarden = this;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pointerdown", this.unlockAudio, true);
    window.addEventListener("keydown", this.unlockAudio, true);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.stage);
    } else {
      window.addEventListener("resize", this.onWindowResize);
    }
    this.resize();
    this.showMainMenu();
    this.rafId = requestAnimationFrame((t) => this.tick(t));
    this.log("started");
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.abortFlow();
    window.removeEventListener("resize", this.onWindowResize);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointerdown", this.unlockAudio, true);
    window.removeEventListener("keydown", this.unlockAudio, true);
    this.resizeObserver?.disconnect();
    this.input.dispose();
    this.debug?.dispose();
    this.audio.dispose();
    const w = window as unknown as { gemGarden?: Game };
    if (w.gemGarden === this) delete w.gemGarden;
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.renderSettings.highContrast = settings.highContrast;
    this.renderSettings.reducedMotion = settings.reducedMotion;
    this.renderSettings.showGridCoords = settings.showGridCoords;
    this.effects.durationScale = this.timeScale();
    this.hint.enabled = settings.hints;
    this.ui.applySettings(settings);
    this.audio.applySettings(settings);
  }

  private resize(): void {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (w < 1 || h < 1) return;
    this.lastDpr = window.devicePixelRatio || 1;
    this.renderer.setBoard(this.board);
    this.renderer.resize(w, h, this.lastDpr);
  }

  // ---------------------------------------------------------------------------
  // Frame loop

  private tick(now: number): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
    const raw = this.lastFrame < 0 ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(raw, TIMING.maxDeltaMs);
    if (raw > 0) this.fps += (1000 / raw - this.fps) * 0.08;
    if ((window.devicePixelRatio || 1) !== this.lastDpr) this.resize();

    if (!this.clockPaused) {
      this.time += dt;
      this.animations.update(dt);
      this.particles.update(dt);
      this.effects.update(dt);
      if (this.fsm.isInputState()) this.hint.update(dt);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt / 450);
    }
    this.render();
    this.debug?.update(now, () => this.debugInfo());
  }

  private render(): void {
    const f = this.frame;
    const inLevel = this.fsm.isInLevel();
    f.board = this.board;
    f.selected = inLevel ? this.selected : null;
    f.cursor = inLevel ? this.input.getCursor() : null;
    f.cursorVisible = inLevel && this.cursorVisible && this.fsm.isInputState();
    f.hover = this.fsm.isInputState() ? this.hover : null;
    const hint = this.fsm.isInputState() ? this.hint.hint : null;
    f.hint = hint ? { a: hint.a, b: hint.b, t: this.hint.phase } : null;
    f.shake = this.shake;
    f.time = this.time;
    f.dimmed = this.fsm.isDimmed();
    this.renderer.draw(f);
  }

  private debugInfo(): DebugInfo {
    const idle = this.fsm.isInputState();
    const messages: string[] = [];
    if (idle) {
      messages.push(findMatches(this.board).length === 0 ? "board has no matches" : "BOARD HAS MATCHES AT REST");
      messages.push(hasValidMove(this.board) ? "has valid move" : "NO VALID MOVE");
    } else if (this.fsm.isInLevel()) {
      messages.push("board resolving");
    }
    return {
      state: this.fsm.current,
      fps: this.fps,
      cursor: this.fsm.isInLevel() ? this.input.getCursor() : null,
      selected: this.selected,
      levelId: this.level?.id ?? null,
      seed: this.board.rng.seed,
      validMoves: idle ? this.hint.validMoveCount : null,
      activeGroups: this.activeGroups,
      cascadeIndex: this.cascadeIndex,
      movesLeft: this.movesLeft,
      score: this.scoring.total,
      showGridCoords: this.settings.showGridCoords,
      messages,
    };
  }

  private log(...args: unknown[]): void {
    this.debug?.log(...args);
  }

  // ---------------------------------------------------------------------------
  // Screens

  showMainMenu(): void {
    this.leaveLevel("MAIN_MENU");
    this.ui.showMainMenu({ hasProgress: this.save.highestUnlocked > 1 });
  }

  showLevelSelect(): void {
    this.leaveLevel("LEVEL_SELECT");
    this.ui.showLevelSelect(this.levels.all(), (id) => this.save.getProgress(id), this.save.highestUnlocked);
  }

  private leaveLevel(to: GameState): void {
    this.abortFlow();
    this.clockPaused = false;
    this.input.setMode("off");
    this.ui.hideTutorial();
    this.ui.setCascadeLabel("");
    this.fsm.set(to);
  }

  /** Stops whatever move flow is running; the awaiting code bails out on its next step. */
  private abortFlow(): void {
    this.session++;
    this.introSkip?.();
    this.introSkip = null;
    this.animations.finishAll();
    for (const g of this.ghosts) this.animations.removeVisual(g.token.id);
    this.ghosts.length = 0;
    this.effects.clear();
    this.particles.clear();
    this.shake = 0;
    this.selected = null;
    this.hint.reset();
  }

  // ---------------------------------------------------------------------------
  // Level lifecycle

  /** Loads a level and resolves once the intro is over and input is open. */
  startLevel(id: number, seed?: number): Promise<void> {
    const base = this.levels.getById(id);
    if (!base) return Promise.reject(new Error(`No level with id ${id}`));
    const level: LevelDefinition = seed === undefined ? base : { ...base, seed };
    this.abortFlow();
    this.clockPaused = false;
    let board: Board;
    try {
      board = Board.fromLevel(level);
    } catch (err) {
      console.error(err);
      this.ui.toast("That bed would not grow. Try again.");
      this.showMainMenu();
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    const session = this.session;
    this.level = level;
    this.board = board;
    this.resolver = new RoundResolver(board, board.rng, level);
    this.tracker = ObjectiveTracker.fromLevel(level, board);
    this.scoring.reset();
    this.movesLeft = level.moveLimit;
    this.delivered = 0;
    this.cascadeIndex = 0;
    this.activeGroups = 0;
    this.tutorialShown = false;
    this.animations.clear();
    this.renderer.setBoard(board);
    this.resize();
    this.input.setGrid(board.rows, board.cols, (r, c) => board.isPlayable(r, c));
    this.cursorVisible = false;

    this.ui.hideOverlays();
    this.ui.showHud(level);
    this.syncHud();
    this.ui.showLevelIntro(level, this.tracker.statuses());
    if (level.tutorialMessage) {
      this.ui.showTutorial(level.tutorialMessage);
      this.tutorialShown = true;
    }
    this.fsm.set("LEVEL_INTRO");
    this.input.setMode("play");
    this.canvas.focus({ preventScroll: true });
    this.log(`level ${level.id} "${level.name}" seed ${board.rng.seed}`);

    const skip = new Promise<void>((resolve) => {
      this.introSkip = resolve;
    });
    return Promise.race([this.wait(this.ms(TIMING.levelIntro)), skip]).then(() => {
      if (session !== this.session) return;
      this.introSkip = null;
      this.ui.hideIntro();
      // A pause that landed during the intro stays; input opens when it is resumed.
      if (this.fsm.is("PAUSED")) this.resumeState = "PLAYER_INPUT";
      else this.fsm.set("PLAYER_INPUT");
      this.hint.onBoardStable(board, level);
    });
  }

  private skipIntro(): void {
    if (this.fsm.is("LEVEL_INTRO")) this.introSkip?.();
  }

  restart(): void {
    if (!this.level) return;
    void this.startLevel(this.level.id, this.level.seed);
  }

  nextLevel(): void {
    const next = this.level ? this.levels.next(this.level.id) : null;
    if (next && this.save.isUnlocked(next.id)) void this.startLevel(next.id);
    else this.showLevelSelect();
  }

  /** Debug: same level, fresh random seed. */
  regenerateBoard(): void {
    if (!this.level) return;
    void this.startLevel(this.level.id, Random.randomSeed());
  }

  pause(): void {
    if (!this.fsm.isInLevel() || this.fsm.is("PAUSED")) return;
    this.resumeState = this.fsm.current;
    this.fsm.set("PAUSED");
    this.clockPaused = true;
    this.input.setMode("paused");
    this.ui.showPause();
  }

  resume(): void {
    if (!this.fsm.is("PAUSED")) return;
    this.fsm.set(this.resumeState);
    this.clockPaused = false;
    this.input.setMode("play");
    this.ui.hidePause();
    this.hint.onInput();
    this.canvas.focus({ preventScroll: true });
  }

  togglePause(): void {
    if (this.fsm.is("PAUSED")) this.resume();
    else this.pause();
  }

  showHint(): void {
    if (!this.fsm.isInputState()) return;
    const hint = this.hint.showNow();
    if (!hint) this.ui.toast("No move to suggest right now.");
  }

  // ---------------------------------------------------------------------------
  // Board interaction

  private onSelect(pos: CellPosition): void {
    if (!this.fsm.isInputState()) return;
    this.hint.onInput();
    const cell = this.board.get(pos.row, pos.col);
    if (!cell || !cell.playable) return;
    if (!cell.token) {
      this.selected = null;
      return;
    }
    if (this.selected) {
      if (samePos(this.selected, pos)) {
        this.selected = null;
        return;
      }
      if (adjacent(this.selected, pos)) {
        const a = this.selected;
        this.selected = null;
        void this.runMove(a, pos);
        return;
      }
    }
    this.selected = { row: pos.row, col: pos.col };
    this.audio.play("select");
  }

  private onSwapIntent(a: CellPosition, b: CellPosition): void {
    if (!this.fsm.isInputState()) return;
    this.hint.onInput();
    this.selected = null;
    void this.runMove(a, b);
  }

  private async runMove(a: CellPosition, b: CellPosition): Promise<void> {
    if (!this.fsm.isInputState() || !this.resolver || !this.level) return;
    const session = this.session;
    try {
      await this.moveFlow(a, b, session);
    } catch (err) {
      if (err === ABORT) return;
      console.error("[gemgarden] move flow failed", err);
      if (session === this.session && this.fsm.isInLevel() && !this.fsm.is("PAUSED")) {
        this.ghosts.length = 0;
        this.fsm.set("PLAYER_INPUT");
        this.hint.onBoardStable(this.board, this.level);
      }
    }
  }

  private async moveFlow(a: CellPosition, b: CellPosition, s: number): Promise<void> {
    const board = this.board;
    const resolver = this.resolver as RoundResolver;
    const level = this.level as LevelDefinition;
    this.fsm.set("SWAPPING");
    this.selected = null;
    this.hint.reset();

    const outcome = resolver.trySwap(a, b);
    if (!outcome.valid) {
      this.audio.play("invalid");
      await this.guard(s, this.animateInvalidSwap(a, b));
      this.fsm.set("PLAYER_INPUT");
      this.hint.onBoardStable(board, level);
      return;
    }
    this.audio.play("swap");
    await this.guard(s, this.animateSwap(a, b));
    this.movesLeft--;
    if (this.tutorialShown) {
      this.ui.hideTutorial();
      this.tutorialShown = false;
    }
    this.syncHud();

    this.fsm.set("RESOLVING_MATCHES");
    let cascade = 0;
    let step = resolver.resolveClear(0, outcome.activations);
    if (!step) {
      // A seed pushed straight down: nothing clears, but it may still fall and deliver.
      await this.fallPhase(s, 0);
      cascade = 1;
      this.fsm.set("RESOLVING_MATCHES");
      step = resolver.resolveClear(cascade);
    }
    while (step) {
      await this.clearPhase(s, step);
      await this.fallPhase(s, cascade);
      cascade++;
      this.fsm.set("RESOLVING_MATCHES");
      step = resolver.resolveClear(cascade);
    }
    this.cascadeIndex = 0;
    this.activeGroups = 0;

    const spreads = resolver.endOfMove();
    if (spreads.length > 0) await this.spreadPhase(s, spreads);
    this.awardObjectiveBonuses();
    this.syncHud();

    const tracker = this.tracker as ObjectiveTracker;
    if (tracker.allComplete()) {
      this.finishLevel(true);
      return;
    }
    if (this.movesLeft <= 0) {
      this.finishLevel(false);
      return;
    }
    if (!hasValidMove(board)) {
      const ok = await this.reshufflePhase(s);
      if (!ok) {
        this.finishLevel(false, STILL_MESSAGE);
        return;
      }
    }
    this.fsm.set("PLAYER_INPUT");
    this.hint.onBoardStable(board, level);
  }

  private animateSwap(a: CellPosition, b: CellPosition): Promise<void> {
    // Tokens are already swapped on the board; start each at its old cell and slide home.
    const atB = this.board.tokenAt(b.row, b.col);
    const atA = this.board.tokenAt(a.row, a.col);
    const dur = this.ms(TIMING.swap);
    const tweens: Promise<void>[] = [];
    if (atB) {
      this.animations.set(atB.id, { x: a.col - b.col, y: a.row - b.row, scale: 1.12 });
      tweens.push(this.animations.tween(atB.id, { x: 0, y: 0, scale: 1 }, dur, easeInOutQuad));
    }
    if (atA) {
      this.animations.set(atA.id, { x: b.col - a.col, y: b.row - a.row });
      tweens.push(this.animations.tween(atA.id, { x: 0, y: 0 }, dur, easeInOutQuad));
    }
    return Promise.all(tweens).then(() => undefined);
  }

  private async animateInvalidSwap(a: CellPosition, b: CellPosition): Promise<void> {
    const ta = this.board.tokenAt(a.row, a.col);
    const tb = this.board.tokenAt(b.row, b.col);
    const out = this.ms(TIMING.swap);
    const back = this.ms(TIMING.swapBack);
    const dx = b.col - a.col;
    const dy = b.row - a.row;
    const legs: Promise<void>[] = [];
    if (ta) legs.push(this.animations.tween(ta.id, { x: dx * 0.6, y: dy * 0.6 }, out, easeOutCubic));
    if (tb) legs.push(this.animations.tween(tb.id, { x: -dx * 0.6, y: -dy * 0.6 }, out, easeOutCubic));
    await Promise.all(legs);
    const returns: Promise<void>[] = [];
    if (ta) returns.push(this.animations.tween(ta.id, { x: 0, y: 0 }, back, easeOutBack));
    if (tb) returns.push(this.animations.tween(tb.id, { x: 0, y: 0 }, back, easeOutBack));
    await Promise.all(returns);
  }

  private async clearPhase(s: number, step: ClearStep): Promise<void> {
    const tracker = this.tracker as ObjectiveTracker;
    this.cascadeIndex = step.cascadeIndex;
    this.activeGroups = step.groups.length;
    tracker.onClear(step);
    this.addScore(step.scoreGained);
    this.shake = Math.max(this.shake, step.shake);

    if (step.cascadeIndex > 0) {
      const label = cascadeLabel(step.cascadeIndex);
      this.ui.setCascadeLabel(label);
      if (step.cascadeIndex >= 3) this.effects.cascadeBanner(label);
      this.audio.play("cascade", step.cascadeIndex);
    } else if (step.groups.length > 0) {
      const big = step.groups.some((g) => g.cells.length >= 4);
      this.audio.play(big ? "bigMatch" : "match");
    }
    if (step.created.length > 0) this.audio.play("specialCreate");
    if (step.activations.length > 0) this.audio.play("specialActivate");
    if (step.blockerHits.length > 0) this.audio.play("blockerHit");

    const clearMs = this.ms(TIMING.clear);
    const pending: Promise<void>[] = [];
    const cs = this.renderer.layout.cellSize;

    for (const c of step.cleared) {
      this.ghosts.push({ token: c.token, at: c.at });
      const v = this.animations.set(c.token.id, { x: 0, y: 0 });
      v.glow = 1;
      this.animations.tween(c.token.id, { scale: 1.25 }, clearMs * 0.3, easeOutCubic);
      pending.push(this.animations.tween(c.token.id, { scale: 0, alpha: 0, rot: (c.token.id % 2 ? 1 : -1) * 0.7 }, clearMs * 0.7, easeInQuad, clearMs * 0.3));
      const p = this.renderer.cellToXY(c.at.row, c.at.col);
      this.burst(p.x, p.y, tokenParticleColors(c.token), 9, cs * 0.1, "petal");
    }

    for (const created of step.created) {
      const id = created.token.id;
      const v = this.animations.set(id, { x: 0, y: 0, glow: 1 });
      v.scale = 1;
      this.animations.tween(id, { scale: 1.45 }, clearMs * 0.45, easeOutBack);
      pending.push(this.animations.tween(id, { scale: 1, glow: 0 }, this.ms(TIMING.specialActivate), easeOutCubic, clearMs * 0.45));
      if (created.type !== "none") {
        const color = created.color ? TOKEN_STYLE[created.color].light : "#ffffff";
        this.effects.floatingText(created.at, SPECIAL_NAMES[created.type], { color, size: 0.8 });
      }
    }

    for (const act of step.activations) this.showActivation(act, step);

    for (const hit of step.blockerHits) {
      const p = this.renderer.cellToXY(hit.at.row, hit.at.col);
      this.burst(p.x, p.y, BLOCKER_PARTICLE[hit.type], hit.destroyed ? 14 : 6, cs * 0.08, "spark");
    }
    for (const hit of step.terrainHits) {
      const p = this.renderer.cellToXY(hit.at.row, hit.at.col);
      this.burst(p.x, p.y, MOSS_PARTICLE, 6, cs * 0.07, "circle");
    }

    step.scoreEvents.forEach((ev, i) => {
      if (ev.points <= 0) return;
      const group = i < step.groups.length ? step.groups[i] : null;
      const act = group ? null : step.activations[i - step.groups.length];
      const color = group ? TOKEN_STYLE[group.color].light : "#ffe89a";
      const label = ev.label ?? (act && act.type !== "none" ? SPECIAL_NAMES[act.type] : undefined);
      this.effects.floatingText(ev.at, `+${ev.points}`, { color, label, size: act ? 1.15 : 1 });
    });

    if (step.activations.length > 0) pending.push(this.wait(this.ms(TIMING.specialActivate)));
    await this.guard(s, Promise.all(pending));

    for (const c of step.cleared) this.animations.removeVisual(c.token.id);
    this.removeGhosts(step.cleared.map((c) => c.token.id));
    this.syncHud();
  }

  private showActivation(act: SpecialActivation, step: ClearStep): void {
    let color = "#ffffff";
    if (act.color) color = TOKEN_STYLE[act.color].light;
    else {
      const gone = step.cleared.find((c) => samePos(c.at, act.at));
      if (gone?.token.color) color = TOKEN_STYLE[gone.token.color].light;
    }
    if (act.lines) for (const line of act.lines) this.effects.beam(line.orientation, line.index, color);
    if (act.radius !== undefined) this.effects.burstRing(act.at, act.radius, color);
    if (act.type === "prism") {
      this.effects.prismFlash();
      if (act.combo === "prismPrism" || act.combo === "prismColor") this.effects.boardPulse(color);
    }
    const p = this.renderer.cellToXY(act.at.row, act.at.col);
    this.burst(p.x, p.y, [color, "#ffffff"], 16, this.renderer.layout.cellSize * 0.09, "spark", 260);
  }

  private async fallPhase(s: number, cascade: number): Promise<void> {
    const resolver = this.resolver as RoundResolver;
    const tracker = this.tracker as ObjectiveTracker;
    this.fsm.set("FALLING");
    const fall: FallStep = resolver.fall(cascade, this.delivered);
    this.delivered += fall.delivered.length;
    tracker.onFall(fall);
    this.addScore(fall.scoreGained);

    const segTop = new Map<number, number>();
    for (const seg of columnSegments(this.board)) {
      for (let r = seg.top; r <= seg.bottom; r++) segTop.set(r * this.board.cols + seg.col, seg.top);
    }
    const deliveredIds = new Set(fall.delivered.map((d) => d.token.id));
    const settle: Promise<void>[] = [];
    const spawn: Promise<void>[] = [];

    for (const move of fall.moves) {
      const id = move.token.id;
      if (deliveredIds.has(id)) this.ghosts.push({ token: move.token, at: move.to });
      const distance = Math.max(1, move.to.row - move.from.row);
      const duration = this.ms(clamp(distance * TIMING.fallPerCell, TIMING.fallMin, TIMING.fallMax));
      const top = segTop.get(move.to.row * this.board.cols + move.to.col) ?? 0;
      const delay = move.spawned ? this.ms(Math.max(0, top - move.from.row - 1) * TIMING.spawnDelayPerRow) : 0;
      this.animations.set(id, { x: move.from.col - move.to.col, y: move.from.row - move.to.row, scale: 1, rot: 0 });
      const p = this.animations.tween(id, { x: 0, y: 0 }, duration, fallEasing(distance), delay);
      if (move.spawned) {
        this.animations.set(id, { alpha: 0 });
        this.animations.tween(id, { alpha: 1 }, Math.min(duration, this.ms(140)), linear, delay);
        spawn.push(p);
      } else {
        settle.push(p);
      }
    }
    await this.guard(s, Promise.all(settle));
    if (spawn.length > 0) {
      this.fsm.set("REFILLING");
      await this.guard(s, Promise.all(spawn));
    }

    if (fall.delivered.length > 0) {
      this.audio.play("seedDelivered");
      const cs = this.renderer.layout.cellSize;
      const pops: Promise<void>[] = [];
      for (const d of fall.delivered) {
        const p = this.renderer.cellToXY(d.at.row, d.at.col);
        this.burst(p.x, p.y, SEED_PARTICLE, 18, cs * 0.1, "circle", 240);
        pops.push(this.animations.tween(d.token.id, { scale: 1.6, alpha: 0 }, this.ms(TIMING.clear), easeOutCubic));
      }
      for (const ev of fall.scoreEvents) this.effects.floatingText(ev.at, `+${ev.points}`, { label: ev.label, color: "#ffd77a" });
      await this.guard(s, Promise.all(pops));
      for (const d of fall.delivered) this.animations.removeVisual(d.token.id);
      this.removeGhosts(fall.delivered.map((d) => d.token.id));
    }
    this.syncHud();
  }

  private async spreadPhase(s: number, events: SpreadEvent[]): Promise<void> {
    const cs = this.renderer.layout.cellSize;
    for (const ev of events) {
      const moss = ev.kind === "moss";
      this.effects.burstRing(ev.at, 0.2, moss ? "#6ff0a0" : "#b79cff");
      const p = this.renderer.cellToXY(ev.at.row, ev.at.col);
      this.burst(p.x, p.y, moss ? MOSS_PARTICLE : BLOCKER_PARTICLE.shadowMist, 10, cs * 0.08, "circle", 90);
      this.log(`${ev.kind} spread to ${ev.at.row},${ev.at.col}`);
    }
    await this.guard(s, this.wait(this.ms(260)));
  }

  private async reshufflePhase(s: number): Promise<boolean> {
    this.fsm.set("RESHUFFLING");
    const result = reshuffle(this.board, this.board.rng);
    this.log(`reshuffle: ${result.moved.length} moved, success ${result.success}`);
    if (!result.success) return false;
    this.ui.toast(RESHUFFLE_TEXT);
    this.audio.play("reshuffle");
    this.effects.boardPulse("#b9fff0");
    const dur = this.ms(TIMING.reshuffle);
    const tweens: Promise<void>[] = [];
    for (const m of result.moved) {
      this.animations.set(m.token.id, { x: m.from.col - m.to.col, y: m.from.row - m.to.row });
      tweens.push(this.animations.tween(m.token.id, { x: 0, y: 0 }, dur, easeInOutQuad));
    }
    await this.guard(s, Promise.all(tweens));
    return true;
  }

  private awardObjectiveBonuses(): void {
    const tracker = this.tracker as ObjectiveTracker;
    const centre = { row: (this.board.rows - 1) / 2, col: (this.board.cols - 1) / 2 };
    // The bonus can itself finish a score objective, so keep asking until nothing new completes.
    for (let guard = 0; guard < 8; guard++) {
      const done = tracker.newlyCompleted();
      if (done.length === 0) break;
      for (const o of done) {
        this.addScore(SCORE.objectiveCompleted);
        this.effects.floatingText(centre, `+${SCORE.objectiveCompleted}`, { label: `${o.label} done`, color: "#ffe89a", size: 1.3 });
        this.audio.play("bigMatch");
      }
    }
  }

  private finishLevel(won: boolean, message?: string): void {
    const level = this.level as LevelDefinition;
    const tracker = this.tracker as ObjectiveTracker;
    this.fsm.set(won ? "LEVEL_COMPLETE" : "LEVEL_FAILED");
    this.input.setMode("off");
    this.hint.reset();
    this.selected = null;
    this.ui.hideTutorial();

    let stars = 0;
    let bestScore = this.save.getProgress(level.id).bestScore;
    let isNewBest = false;
    if (won) {
      const bonus = this.movesLeft * SCORE.levelCompletionMoveBonus;
      if (bonus > 0) {
        this.addScore(bonus);
        this.effects.floatingText({ row: (this.board.rows - 1) / 2, col: (this.board.cols - 1) / 2 }, `+${bonus}`, {
          label: `${this.movesLeft} moves left`,
          color: "#ffe89a",
          size: 1.3,
        });
      }
      stars = this.scoring.starsForWin(level, this.scoring.total);
      const rec = this.save.recordResult(level.id, this.scoring.total, stars);
      bestScore = rec.progress.bestScore;
      isNewBest = rec.isNewBest;
      this.audio.play("levelComplete");
      this.celebrate();
    } else {
      this.audio.play("levelFail");
    }
    this.syncHud();
    const result: LevelResult = {
      levelId: level.id,
      won,
      score: this.scoring.total,
      bestScore,
      stars,
      movesLeft: this.movesLeft,
      objectives: tracker.statuses(),
      isNewBest,
    };
    this.log(`level ${level.id} ${won ? "won" : "failed"}: score ${result.score}, stars ${stars}, moves left ${this.movesLeft}`);

    const session = this.session;
    void this.wait(this.ms(won ? 900 : 600)).then(() => {
      if (session !== this.session) return;
      if (won) this.ui.showLevelComplete(result, this.levels.next(level.id) !== null);
      else this.ui.showLevelFailed(result, message);
    });
  }

  private celebrate(): void {
    const { originX, originY, cellSize, rows, cols } = this.renderer.layout;
    const colors = ["#ffd77a", "#6ff0a0", "#ff8aa0", "#8fd0ff", "#d2a8ff", "#ffffff"];
    for (let i = 0; i < 6; i++) {
      const x = originX + cellSize * cols * (0.1 + 0.8 * (i / 5));
      const y = originY + cellSize * rows * (i % 2 ? 0.3 : 0.6);
      this.burst(x, y, colors, 24, cellSize * 0.1, "petal", 160, 1400);
    }
    this.effects.boardPulse("#ffe89a");
  }

  // ---------------------------------------------------------------------------
  // Helpers

  private addScore(points: number): void {
    if (points === 0) return;
    const total = this.scoring.add(points);
    this.tracker?.onScore(total);
  }

  private syncHud(): void {
    if (!this.level || !this.tracker) return;
    const progress = this.scoring.progressToNextStar(this.level, this.scoring.total);
    this.ui.updateHud({
      movesLeft: this.movesLeft,
      score: this.scoring.total,
      objectives: this.tracker.statuses(),
      starFraction: progress.fraction,
      stars: progress.stars,
    });
  }

  private removeGhosts(ids: number[]): void {
    const gone = new Set(ids);
    let write = 0;
    for (const g of this.ghosts) if (!gone.has(g.token.id)) this.ghosts[write++] = g;
    this.ghosts.length = write;
  }

  private burst(
    x: number,
    y: number,
    colors: string[],
    count: number,
    size: number,
    shape: "circle" | "petal" | "spark",
    speed = 150,
    life = 650,
  ): void {
    const n = this.settings.reducedMotion ? Math.ceil(count * 0.4) : count;
    this.particles.emit(x, y, { count: n, color: colors, speed, life, size, gravity: 260, spread: Math.PI, shape, spin: 8, drag: 1.2 });
  }

  private timeScale(): number {
    return this.speed * (this.settings.reducedMotion ? 0.5 : 1);
  }

  /** A TIMING duration scaled by the animation speed and reduced-motion setting. */
  private ms(base: number): number {
    return Math.max(1, base * this.timeScale());
  }

  /** A pause on the game clock, so it freezes with the rest while paused. */
  private wait(ms: number): Promise<void> {
    return this.animations.tweenValue({ t: 0 }, { t: 1 }, ms, linear);
  }

  private async guard<T>(session: number, p: Promise<T>): Promise<T> {
    const value = await p;
    if (session !== this.session) throw ABORT;
    return value;
  }

  private backgroundBoard(): Board {
    try {
      return Board.fromLevel(this.levels.first(), new Random(Random.randomSeed()));
    } catch {
      return new Board({ rows: 8, cols: 8, tokenTypes: ["ruby", "azure", "jade"], allowedSpecials: [] });
    }
  }

  // ---------------------------------------------------------------------------
  // Test and debug surface (window.gemGarden)

  getState(): GameState {
    return this.fsm.current;
  }

  getBoard(): Board {
    return this.board;
  }

  getLevel(): LevelDefinition | null {
    return this.level;
  }

  findMoves(): Move[] {
    return findValidMoves(this.board);
  }

  /** The hint's pick: the valid move with the best first-step score. */
  bestMove(): Hint | null {
    return this.hint.bestMove;
  }

  /** Plays a move and resolves once the board is at rest again (or the level ended). */
  playMove(a: CellPosition, b: CellPosition): Promise<void> {
    if (!this.fsm.isInputState()) return Promise.reject(new Error(`playMove: state is ${this.fsm.current}`));
    return this.runMove(a, b);
  }

  getScore(): number {
    return this.scoring.total;
  }

  getMovesLeft(): number {
    return this.movesLeft;
  }

  getObjectives(): ObjectiveStatus[] {
    return this.tracker ? this.tracker.statuses() : [];
  }

  getSelected(): CellPosition | null {
    return this.selected ? { ...this.selected } : null;
  }

  getCursor(): CellPosition {
    return this.input.getCursor();
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  /** Multiplies every TIMING duration; 0.15 makes automated runs quick. */
  setAnimationSpeed(multiplier: number): void {
    this.speed = Math.max(0.01, multiplier);
    this.effects.durationScale = this.timeScale();
  }

  forceWin(): void {
    if (!this.fsm.isInLevel()) return;
    this.abortFlow();
    this.clockPaused = false;
    this.ui.hidePause();
    this.ui.hideIntro();
    this.finishLevel(true);
  }

  forceFail(): void {
    if (!this.fsm.isInLevel()) return;
    this.abortFlow();
    this.clockPaused = false;
    this.ui.hidePause();
    this.ui.hideIntro();
    this.finishLevel(false);
  }
}
