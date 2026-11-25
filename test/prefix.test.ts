// The built pages must work under a path prefix the proxy strips (https://host/bodymap/): relative URLs only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = (name: string): string => {
  try {
    return readFileSync(fileURLToPath(new URL("../dist/" + name, import.meta.url)), "utf8");
  } catch {
    throw new Error("dist/" + name + " is missing. Run: npm run build");
  }
};

/** Every place a page can name a same-origin absolute path: fetch, URL, attributes, string literals that start /api. */
export function absolutePaths(code: string): string[] {
  const patterns = [
    /fetch\(\s*["'`]\/[^/]/g,
    /new (?:URL|Request|EventSource|WebSocket|Worker)\(\s*["'`]\/[^/]/g,
    /\b(?:src|href|action|poster|data)=["']\/[^/]/g,
    /\burl\(\s*["']?\/[^/]/g,
    /["'`]\/api\b/g,
    /location\.(?:href|pathname)\s*=\s*["'`]\//g,
  ];
  return patterns.flatMap((p) => code.match(p) ?? []);
}

test("the checker finds absolute paths: it fails on the old page and on each pattern it claims to catch", () => {
  assert.equal(absolutePaths('await fetch("/api/state")').length, 2);
  assert.equal(absolutePaths('<img src="/logo.png">').length, 1);
  assert.equal(absolutePaths('x=new URL("/mcp",o)').length, 1);
  assert.equal(absolutePaths('a{background:url(/x.png)}').length, 1);
  assert.equal(absolutePaths('fetch("api/state");fetch("//cdn.example/x")').length, 0, "relative and protocol-relative are not same-origin absolute");
});

for (const name of ["web.html", "view.html"]) {
  test(name + " names no absolute path", () => {
    assert.deepEqual(absolutePaths(dist(name)), []);
  });
}

test("web.html calls api/state and api/edit, and both resolve under the proxy prefix", () => {
  const html = dist("web.html");
  const found = new Set([...html.matchAll(/["'`](\/?api\/[a-z.]+)["'`]/g)].map((m) => m[1] as string));
  assert.deepEqual([...found].sort(), ["api/edit", "api/state"]);
  for (const path of found) {
    assert.equal(new URL(path, "https://gym.tailcab34c.ts.net/bodymap/").pathname, "/bodymap/" + path);
    assert.equal(new URL(path, "http://127.0.0.1:8104/").pathname, "/" + path, "and still the root when there is no proxy");
  }
});

test("web.html gives a page opened as /bodymap its slash, so the relative URLs resolve under the prefix", () => {
  const html = dist("web.html");
  assert.match(html, /endsWith\(["']\/["']\)/);
  assert.equal(new URL("api/state", "https://h/bodymap").pathname, "/api/state", "without the slash they would leave the prefix");
});
