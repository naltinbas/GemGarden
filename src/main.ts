// Temporary bootstrap: mounts the menu and audio so the UI can be exercised. Stage 6 replaces this.
import "./ui/styles.css";
import { UIManager } from "./ui/UIManager";
import { AudioManager } from "./game/AudioManager";
import { SaveManager } from "./game/SaveManager";
import { levelRepository } from "./levels/LevelRepository";
import type { Settings } from "./game/Types";

const canvas = document.getElementById("board") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui");
const fallback = document.getElementById("fallback");
if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) throw new Error("Missing #board or #ui");
if (!canvas.getContext("2d")) {
  canvas.hidden = true;
  if (fallback) fallback.hidden = false;
}

const save = new SaveManager();
const audio = new AudioManager();

function applySettings(settings: Settings): void {
  ui.applySettings(settings);
  audio.applySettings(settings);
}

const ui = new UIManager(
  uiRoot,
  {
    onPlay: () => startLevel(1),
    onContinue: () => startLevel(Math.min(save.highestUnlocked, levelRepository.count)),
    onLevelSelect: (id) => startLevel(id),
    onResume: () => ui.hidePause(),
    onRestart: () => ui.hideOverlays(),
    onNext: () => ui.hideOverlays(),
    onMainMenu: () => ui.showMainMenu({ hasProgress: save.highestUnlocked > 1 }),
    onLevelSelectScreen: () => ui.showLevelSelect(levelRepository.all(), (id) => save.getProgress(id), save.highestUnlocked),
    onToggleSound: () => applySettings(save.updateSettings({ sound: !save.settings.sound })),
    onSettingsChange: (patch) => applySettings(save.updateSettings(patch)),
    onResetProgress: () => {
      save.reset();
      ui.showMainMenu({ hasProgress: false });
    },
    onHint: () => ui.toast("Hints arrive with the game loop."),
    onUiSound: (name) => audio.play(name),
  },
  { focusTarget: canvas },
);

function startLevel(id: number): void {
  const level = levelRepository.getById(id);
  if (!level) return;
  ui.hideOverlays();
  ui.showHud(level);
  ui.updateHud({ movesLeft: level.moveLimit, score: 0, objectives: [], starFraction: 0, stars: 0 });
  if (level.tutorialMessage) ui.showTutorial(level.tutorialMessage);
  canvas.focus();
}

const unlock = () => audio.unlock();
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

applySettings(save.settings);
ui.showMainMenu({ hasProgress: save.highestUnlocked > 1 });

(window as { gemGardenUi?: UIManager }).gemGardenUi = ui;
