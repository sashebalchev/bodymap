// Shows that each law's test can fail: copy the repo, break one rule at a time, expect the tests to go red.
//   TMPDIR=<scratch> node scripts/mutants.mjs
// The copy shares node_modules by symlink and is deleted at the end.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const MUTANTS = [
  ["Claude's level is not capped", "src/domain.ts", "const level = Math.max(1, Math.min(wanted, cap));", "const level = Math.max(1, wanted);"],
  ["Claude may overwrite an existing layer's name check (add over cleared layer)", "src/domain.ts", "if (existing) {", "if (existing && false) {"],
  ["composite includes cleared layers", "src/text.ts", "state.layers.filter((l) => l.level > 0)", "state.layers.slice()"],
  ["opacity is not level / 10", "src/figure.ts", 'opacity="${layer.level / 10}"', 'opacity="${layer.level / 5}"'],
  ["the lowering tool is visible to the model", "src/mcp.ts", '_meta: { ui: { visibility: ["app"] } },\n    },\n    async ({ grant, base, edit })', '_meta: { ui: { visibility: ["model", "app"] } },\n    },\n    async ({ grant, base, edit })'],
  ["the app edit tool skips the grant", "src/mcp.ts", "if (grant !== deps.grant) return denied;\n      const reply", "const reply"],
  ["stale edits are not refused", "src/domain.ts", "if (target.rev > base)", "if (false as boolean)"],
  ["the agent door needs no token", "src/http.ts", "if (!same(presented, config.mcpToken))", "if (false as boolean)"],
  ["the agent token opens the web API", "src/http.ts", "if (!same(bearer(req), config.uiToken)) return json(res, 401", "if (!same(bearer(req), config.uiToken) && !same(bearer(req), config.mcpToken)) return json(res, 401"],
  ["a damaged file is replaced by an empty map", "src/store.ts", 'throw new Error(file + " is not valid JSON.', 'return new Store(file, emptyState(now())); throw new Error(file + " is not valid JSON.'],
  ["the two tokens may be the same", "src/config.ts", "if (mcpToken === uiToken)", "if (false as boolean)"],
  ["cleared time is not recorded", "src/domain.ts", "return { level, activeSince: null, clearedAt: now.toISOString() };", "return { level, activeSince: null, clearedAt: null };"],
];

const run = (dir) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", "--test", "--test-concurrency=1", "test/domain.test.ts", "test/render.test.ts", "test/mcp.test.ts", "test/config.test.ts"], { cwd: dir, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" });
const failedNames = (out) => [...out.matchAll(/^\s*✖ (.+?) \(/gm)].map((m) => m[1]);

const dir = mkdtempSync(join(tmpdir(), "bodymap-mutants-"));
let bad = 0;
try {
  for (const entry of ["src", "test", "package.json", "tsconfig.json"]) cpSync(join(root, entry), join(dir, entry), { recursive: true });
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  const clean = run(dir);
  console.log((clean.status === 0 ? "ok    " : "FAIL  ") + "unbroken copy passes");
  if (clean.status !== 0) bad++;
  for (const [name, file, from, to] of MUTANTS) {
    const path = join(dir, file);
    const original = readFileSync(path, "utf8");
    if (!original.includes(from)) { console.log("FAIL  " + name + ": anchor not found in " + file); bad++; continue; }
    writeFileSync(path, original.replace(from, () => to));
    const out = run(dir);
    const caught = out.status !== 0;
    console.log((caught ? "ok    " : "FAIL  ") + name + (caught ? " -> red: " + failedNames(out.stdout).slice(0, 2).join(" | ").slice(0, 110) : " -> STILL GREEN"));
    if (!caught) bad++;
    writeFileSync(path, original);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(bad ? "\n" + bad + " problem(s)" : "\nEvery broken rule turned a test red.");
process.exit(bad ? 1 : 0);
