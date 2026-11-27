// Bundles the Android app's web part into www/index.html (Capacitor's webDir): one file, no external script or style.
// The same page template and style sheet as the web page; only the entry (and so the backend) differs.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = here + "../";
const pkg = JSON.parse(await readFile(here + "package.json", "utf8"));
const template = await readFile(root + "src/ui/page.html", "utf8");
const style = await readFile(root + "src/ui/style.css", "utf8");

const bundle = await build({
  entryPoints: [here + "src/main.ts"],
  bundle: true, write: false, format: "esm", target: "es2022", minify: true, legalComments: "none", charset: "ascii", platform: "browser",
  define: { __APP_VERSION__: JSON.stringify(pkg.version + " (" + pkg.bodymap.versionCode + ")") },
});
const code = (bundle.outputFiles[0]?.text ?? "").replaceAll("</script", "<\\/script");
const html = template.replace("/*STYLE*/", () => style).replace("<script>/*SCRIPT*/</script>", () => '<script type="module">' + code + "</script>");
await mkdir(here + "www", { recursive: true });
await writeFile(here + "www/index.html", html);
console.log("app/www/index.html", (html.length / 1024).toFixed(0) + " KB");
