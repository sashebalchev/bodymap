// A tiny element builder. Text goes in as text, never as HTML, so a layer name cannot inject markup.
type Child = Node | string | null | false | undefined;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else if (key === "value" || key === "disabled" || key === "checked") (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids) if (kid !== null && kid !== false && kid !== undefined) el.append(kid);
  return el;
}

/** Parse trusted SVG text (made by figure.ts from numbers only) into a group in the SVG namespace. */
export function svgGroup(markup: string): SVGGElement {
  const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g>' + markup + "</g></svg>", "image/svg+xml");
  return document.importNode(doc.documentElement.firstElementChild as SVGGElement, true);
}
