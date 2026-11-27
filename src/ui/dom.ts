// A tiny element builder. Text goes in as text, never as HTML, so a mark's name cannot inject markup.
type Child = Node | string | null | false | undefined;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith("aria-") && typeof value === "boolean") { el.setAttribute(key, String(value)); continue; }
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else if (key === "value" || key === "disabled" || key === "checked") (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids) if (kid !== null && kid !== false && kid !== undefined) el.append(kid);
  return el;
}

/** Parse trusted SVG text (made by figure.ts from numbers and the checked-in drawing) into a group in the SVG namespace. */
export function svgGroup(markup: string): SVGGElement {
  const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g>' + markup + "</g></svg>", "image/svg+xml");
  return document.importNode(doc.documentElement.firstElementChild as SVGGElement, true);
}

// 24 by 24 line icons, drawn with currentColor. Fixed strings, never user text.
const ICONS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  "chevron-up": '<path d="M6 15l6-6 6 6"/>',
} as const;

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + "</svg>", "image/svg+xml");
  return document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
}
