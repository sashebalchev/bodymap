// 1. Inlines the figure drawing (assets/figure) into src/figure-assets.ts with esbuild's text loader, so the server and
//    both front ends carry it as a string and read no file at runtime. The generated file is checked in, so
//    `npm start` works without a build; test/figure.test.ts fails when it is stale.
// 2. Bundles the two front ends into single self-contained HTML files: no external script, style, font or image.
//   dist/view.html  the MCP App (needs the host)
//   dist/web.html   the plain web page
import { build } from "esbuild";
import { figureAssetsModule } from "./figure-assets.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const template = await readFile(root + "src/ui/page.html", "utf8");
const style = await readFile(root + "src/ui/style.css", "utf8");
await mkdir(root + "dist", { recursive: true });

const version = JSON.parse(await readFile(root + "package.json", "utf8")).version;

await writeFile(root + "src/figure-assets.ts", await figureAssetsModule());

for (const [entry, out] of [["mcpview", "view"], ["web", "web"]]) {
  const bundle = await build({
    entryPoints: [root + "src/ui/" + entry + ".ts"],
    bundle: true, write: false, format: "esm", target: "es2022", minify: true, legalComments: "none", charset: "ascii", platform: "browser",
    define: { __APP_VERSION__: JSON.stringify(version) },
  });
  let code = (bundle.outputFiles[0]?.text ?? "").replaceAll("</script", "<\\/script");
  // zod probes for eval with new Function(""). The host's default CSP has no 'unsafe-eval', so the probe is
  // caught but logs a violation. Make the probe fail without trying. If zod changes shape, stop here.
  const probe = 'new Function("")';
  if (entry === "mcpview") {
    if (!code.includes(probe)) throw new Error("zod's eval probe was not found in the MCP App bundle: check scripts/build.mjs");
    code = code.replaceAll(probe, "(()=>{throw 0})()");
  }
  if (/new Function|\beval\(/.test(code)) throw new Error(out + ": the bundle still uses eval or new Function, which the default MCP Apps CSP blocks");
  const html = template.replace("/*STYLE*/", () => style).replace("<script>/*SCRIPT*/</script>", () => '<script type="module">' + code + "</script>");
  await writeFile(root + "dist/" + out + ".html", html);
  console.log("dist/" + out + ".html", (html.length / 1024).toFixed(0) + " KB");
}
