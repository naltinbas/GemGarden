// Inline SVG icons for the HTML overlays. Token shapes mirror the canvas silhouettes.
import type { TokenColor } from "../game/Types";
import { TOKEN_STYLE } from "../game/Config";

const NS = "http://www.w3.org/2000/svg";

export type IconName =
  | TokenColor
  | "score"
  | "moss"
  | "seed"
  | "stoneRoot"
  | "glassVine"
  | "lockedBud"
  | "shadowMist"
  | "star"
  | "lock"
  | "pause"
  | "play"
  | "soundOn"
  | "soundOff"
  | "hint"
  | "check"
  | "close"
  | "back";

const TOKEN_COLORS = new Set<string>(Object.keys(TOKEN_STYLE));

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  return node;
}

function path(d: string, attrs: Record<string, string | number> = {}): SVGPathElement {
  return svgEl("path", { d, ...attrs });
}

function stroke(d: string, color: string, width = 2, extra: Record<string, string | number> = {}): SVGPathElement {
  return path(d, {
    fill: "none",
    stroke: color,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...extra,
  });
}

function tokenShape(color: TokenColor): SVGElement[] {
  const s = TOKEN_STYLE[color];
  const outline = { stroke: s.edge, "stroke-width": 1.2, "stroke-linejoin": "round" };
  switch (color) {
    case "ruby": {
      const g = svgEl("g", {});
      for (let i = 0; i < 5; i++) {
        g.appendChild(svgEl("ellipse", { cx: 12, cy: 6.4, rx: 3.3, ry: 5.2, fill: s.fill, transform: `rotate(${i * 72} 12 12)`, ...outline }));
      }
      g.appendChild(svgEl("circle", { cx: 12, cy: 12, r: 2.6, fill: s.light }));
      return [g];
    }
    case "azure":
      return [
        path("M12 2 C12 2 5 10.5 5 15 A7 7 0 0 0 19 15 C19 10.5 12 2 12 2 Z", { fill: s.fill, ...outline }),
        path("M9 15 A3 3 0 0 0 12 18", { fill: "none", stroke: s.light, "stroke-width": 1.6, "stroke-linecap": "round" }),
      ];
    case "citrine":
      return [
        path("M12 2.5 C17.5 7 17.5 17 12 21.5 C6.5 17 6.5 7 12 2.5 Z", { fill: s.fill, ...outline }),
        stroke("M12 7.5 V16.5 M12 11 C10 10 9.5 9 9.5 8 M12 13.5 C14 12.5 14.5 11.5 14.5 10.5", s.dark, 1.4),
      ];
    case "violet":
      return [
        path("M12 2 C13 8 16 11 22 12 C16 13 13 16 12 22 C11 16 8 13 2 12 C8 11 11 8 12 2 Z", { fill: s.fill, ...outline }),
        path("M12 8 C12.5 11 13 11.5 16 12 C13 12.5 12.5 13 12 16 C11.5 13 11 12.5 8 12 C11 11.5 11.5 11 12 8 Z", { fill: s.light }),
      ];
    case "jade":
      return [
        path("M4 20 C4 8 12 3 21 3 C21 12 16 20 4 20 Z", { fill: s.fill, ...outline }),
        stroke("M4.5 19.5 L18.5 5.5 M9 15 L9.5 10 M13 11 L13.5 6.5 M9 15 L14 15", s.dark, 1.3),
      ];
    case "pearl":
      return [
        svgEl("circle", { cx: 12, cy: 12, r: 9.5, fill: s.fill, ...outline }),
        path("M13.5 4.5 A7.5 7.5 0 0 1 13.5 19.5 A6 7.5 0 0 0 13.5 4.5 Z", { fill: s.dark, opacity: 0.45 }),
        svgEl("circle", { cx: 9, cy: 9, r: 2, fill: s.light }),
      ];
  }
}

function otherShape(name: Exclude<IconName, TokenColor>): SVGElement[] {
  const c = "currentColor";
  switch (name) {
    case "score":
      return [path("M12 2 L14.3 9.7 L22 12 L14.3 14.3 L12 22 L9.7 14.3 L2 12 L9.7 9.7 Z", { fill: "#ffd98a", stroke: "#8a5a10", "stroke-width": 1 })];
    case "moss":
      return [
        svgEl("circle", { cx: 8, cy: 14, r: 5.5, fill: "#3f9a5a" }),
        svgEl("circle", { cx: 15, cy: 10, r: 5, fill: "#5cc47a" }),
        svgEl("circle", { cx: 15.5, cy: 16.5, r: 4.5, fill: "#2f7a46" }),
        svgEl("circle", { cx: 11, cy: 9, r: 1.3, fill: "#b8f5c9" }),
      ];
    case "seed":
      return [
        path("M12 6 C16.5 9.5 16.5 17 12 21 C7.5 17 7.5 9.5 12 6 Z", { fill: "#f2c15a", stroke: "#7a5210", "stroke-width": 1.2 }),
        stroke("M12 6 C12 3.5 13.5 2.5 16 2.5 C16 5 14.5 6 12 6", "#58b56a", 1.6),
        stroke("M12 10 V17", "#a8741c", 1.4),
      ];
    case "stoneRoot":
      return [
        path("M4 18 L6.5 9 L12 5 L18.5 8 L20 17 L15.5 20.5 L7.5 20.5 Z", { fill: "#7c8a88", stroke: "#2d3736", "stroke-width": 1.3, "stroke-linejoin": "round" }),
        stroke("M9 9 L12 13 L10.5 17", "#3d4a48", 1.4),
      ];
    case "glassVine":
      return [
        svgEl("circle", { cx: 12, cy: 12, r: 8, fill: "rgba(160,235,230,0.25)", stroke: "#8fe0d6", "stroke-width": 1.2 }),
        stroke("M5 16 C7 8 17 16 19 8 M6 7 C10 12 14 12 18 17", "#b8f7ef", 1.8),
      ];
    case "lockedBud":
      return [
        path("M12 3 C17 7 17 14.5 12 19 C7 14.5 7 7 12 3 Z", { fill: "#7a4f9e", stroke: "#2b1748", "stroke-width": 1.3 }),
        stroke("M12 3 C13.5 8 13.5 14 12 19 M12 3 C10.5 8 10.5 14 12 19", "#c9a3ea", 1.2),
        svgEl("rect", { x: 8.5, y: 17.5, width: 7, height: 4.5, rx: 1.2, fill: "#e6c45c", stroke: "#5a4410", "stroke-width": 1 }),
      ];
    case "shadowMist":
      return [
        path("M7 18.5 H17.5 A4 4 0 0 0 17.5 10.5 A5.2 5.2 0 0 0 7.5 12 A3.3 3.3 0 0 0 7 18.5 Z", { fill: "#4b4a6e", stroke: "#1f1d33", "stroke-width": 1.3 }),
        stroke("M9 15.5 C11 14 13 17 15 15.5", "#9c99c9", 1.4),
      ];
    case "star":
      return [path("M12 2.5 L14.9 9 L22 9.6 L16.6 14.3 L18.3 21.3 L12 17.6 L5.7 21.3 L7.4 14.3 L2 9.6 L9.1 9 Z", { fill: c })];
    case "lock":
      return [stroke("M7.5 11 V8 A4.5 4.5 0 0 1 16.5 8 V11", c, 2), svgEl("rect", { x: 5, y: 11, width: 14, height: 10, rx: 2, fill: c })];
    case "pause":
      return [svgEl("rect", { x: 6, y: 4, width: 4.5, height: 16, rx: 1.2, fill: c }), svgEl("rect", { x: 13.5, y: 4, width: 4.5, height: 16, rx: 1.2, fill: c })];
    case "play":
      return [path("M7 4 L19 12 L7 20 Z", { fill: c })];
    case "soundOn":
      return [path("M4 9.5 V14.5 H8 L13 19 V5 L8 9.5 Z", { fill: c }), stroke("M16 9 A4.5 4.5 0 0 1 16 15 M18.5 6.5 A8 8 0 0 1 18.5 17.5", c, 1.8)];
    case "soundOff":
      return [path("M4 9.5 V14.5 H8 L13 19 V5 L8 9.5 Z", { fill: c }), stroke("M16 9.5 L21 14.5 M21 9.5 L16 14.5", c, 2)];
    case "hint":
      return [stroke("M12 3 A6 6 0 0 0 8.5 13.8 V16.5 H15.5 V13.8 A6 6 0 0 0 12 3 Z M10 19.5 H14", c, 1.8)];
    case "check":
      return [stroke("M5 12.5 L10 17.5 L19 7", c, 2.6)];
    case "close":
      return [stroke("M6 6 L18 18 M18 6 L6 18", c, 2.4)];
    case "back":
      return [stroke("M14 5 L7 12 L14 19", c, 2.4)];
  }
}

/** Builds a 24x24 viewBox icon. Unknown names give an empty square so callers never crash. */
export function icon(name: string, size = 20, label?: string): SVGSVGElement {
  const svg = svgEl("svg", { viewBox: "0 0 24 24", width: size, height: size, class: `icon icon-${name}` });
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  const parts = TOKEN_COLORS.has(name) ? tokenShape(name as TokenColor) : isIconName(name) ? otherShape(name) : [];
  for (const part of parts) svg.appendChild(part);
  return svg;
}

const OTHER_NAMES: readonly string[] = [
  "score",
  "moss",
  "seed",
  "stoneRoot",
  "glassVine",
  "lockedBud",
  "shadowMist",
  "star",
  "lock",
  "pause",
  "play",
  "soundOn",
  "soundOff",
  "hint",
  "check",
  "close",
  "back",
];

function isIconName(name: string): name is Exclude<IconName, TokenColor> {
  return OTHER_NAMES.includes(name);
}
