import { MuscleMapWidget, getMuscleName, STYLE_PRESETS } from "./vendor/muscle-map/muscle-map.js";
import { getRussianName } from "./muscleZones.js";
import { Profile } from "./profile.js";
import { Theme } from "./theme.js";

const DARK_STYLE = {
  defaultFillColor: "#1a1a1a",
  strokeColor: "#333333",
  strokeWidth: 0.5,
  selectionColor: "#a3e635",
  selectionStrokeColor: "#a3e635",
  selectionStrokeWidth: 2,
  headColor: "#2a2a2a",
  hairColor: "#0a0a0a",
  shadowColor: "rgba(163,230,53,0.3)",
  shadowRadius: 4,
  shadowOffsetX: 0,
  shadowOffsetY: 0
};

const SIDE_KEY = "muscle_map_side";
const GENDER_KEY = "user_gender";

let widget = null;
let clickCallback = null;
let currentSide = "front";
let currentGender = "male";

function resolveGender() {
  const profileGender = Profile?.user?.gender;
  if (profileGender) return profileGender;
  const stored = localStorage.getItem(GENDER_KEY);
  if (stored) return stored;
  return "male";
}

function resolveSide() {
  const stored = localStorage.getItem(SIDE_KEY);
  if (stored) return stored;
  return "front";
}

function applyTheme() {
  if (!widget) return;
  const isDark = Theme?.isDark?.() ?? window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (isDark) {
    widget.setStyle(DARK_STYLE);
  } else {
    widget.setStyle(STYLE_PRESETS.default);
  }
}

function setupTooltip() {
  if (!widget) return;
  widget.enableTooltip((muscle) => {
    return getRussianName(muscle);
  });
}

function setupClickHandler() {
  if (!widget) return;
  widget.on("muscleClick", (muscle) => {
    if (clickCallback) {
      clickCallback(getRussianName(muscle), muscle);
    }
  });
}

function onThemeChange() {
  applyTheme();
}

export const MuscleMap = {
  init(container, options = {}) {
    if (widget) {
      widget.destroy();
    }

    currentGender = resolveGender();
    currentSide = resolveSide();

    widget = new MuscleMapWidget(container, {
      gender: currentGender,
      side: currentSide,
      showSubGroups: true,
      style: DARK_STYLE,
      ...options
    });

    setupTooltip();
    setupClickHandler();
    applyTheme();

    document.addEventListener('themechange', onThemeChange);

    return widget;
  },

  setGender(gender) {
    if (!widget) return;
    currentGender = gender;
    localStorage.setItem(GENDER_KEY, gender);
    widget.setGender(gender);
  },

  setSide(side) {
    if (!widget) return;
    currentSide = side;
    localStorage.setItem(SIDE_KEY, side);
    widget.setSide(side);
  },

  getGender() {
    return currentGender;
  },

  getSide() {
    return currentSide;
  },

  highlightLoad(muscleMap) {
    if (!widget) return;
    widget.clearHighlights();
    widget.setIntensities(muscleMap, "workout");
  },

  highlightRecovery(muscleMap) {
    if (!widget) return;
    widget.clearHighlights();
    widget.setIntensities(muscleMap, "recovery");
  },

  clearHighlights() {
    if (!widget) return;
    widget.clearHighlights();
  },

  setHeatmap(data, config) {
    if (!widget) return;
    widget.setHeatmap(data, config);
  },

  onMuscleClick(callback) {
    clickCallback = callback;
  },

  destroy() {
    if (widget) {
      widget.destroy();
      widget = null;
    }
    document.removeEventListener('themechange', onThemeChange);
  },

  getWidget() {
    return widget;
  }
};

export default MuscleMap;