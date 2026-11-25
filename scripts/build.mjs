// Bundles the two front ends into single self-contained HTML files: no external script, style, font or image.
//   dist/view.html  the MCP App (needs the host)
//   dist/web.html   the plain web page
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const template = await readFile(root + "src/ui/page.html", "utf8");
const style = await readFile(root + "src/ui/style.css", "utf8");
await mkdir(root + "dist", { recursive: true });

for (const [entry, out] of [["mcpview", "view"], ["web", "web"]]) {
  const bundle = await build({
    entryPoints: [root + "src/ui/" + entry + ".ts"],
    bundle: true, write: false, format: "esm", target: "es2022", minify: true, legalComments: "none", charset: "ascii", platform: "browser",
  });
  const code = (bundle.outputFiles[0]?.text ?? "").replaceAll("</script", "<\\/script");
  const html = template.replace("/*STYLE*/", () => style).replace("<script>/*SCRIPT*/</script>", () => '<script type="module">' + code + "</script>");
  await writeFile(root + "dist/" + out + ".html", html);
  console.log("dist/" + out + ".html", (html.length / 1024).toFixed(0) + " KB");
}
