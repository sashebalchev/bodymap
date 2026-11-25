# bodymap

Alex paints where he feels tension, pinching or pain on a rough front and back outline of a man.
Claude reads it before it plans a session. One small Node service, two doors:

- **MCP App** at `/mcp`. Claude shows the interactive canvas inside the chat (`show_body_map`), reads the map (`get_body_map`) and can add a layer from words (`add_layer`).
- **Plain web page** at `/`. The same canvas and the same API, for when the MCP App does not render.

## The rules (each one has a test)

1. Only Alex lowers a slider or deletes a layer. Claude's tools are `show_body_map`, `get_body_map`, `add_layer`. None of them can lower, clear or delete. The tools that can (`body_map_edit`, `body_map_state`) are `visibility: ["app"]`, so hosts must keep them out of the model's tool list, and they also demand a grant that exists only inside the app's own HTML.
2. `add_layer` only creates. A name that exists, cleared or not, is refused and nothing changes.
3. Claude's level is capped (`BODYMAP_CLAUDE_MAX_LEVEL`, default 4). Alex can raise it.
4. The picture holds only layers above 0, each at opacity level / 10. Level 0 = cleared, greyed in the list, absent from the picture, remembered in the text list.
5. An edit made from a screen that is older than the layer is refused (HTTP 409), and the screen refreshes.
6. A damaged data file stops the server. It is never overwritten.

## Run it

```sh
npm ci
npm run build                 # dist/view.html (MCP App) and dist/web.html, each one self-contained file
export BODYMAP_DATA_DIR=$PWD/data
export BODYMAP_MCP_TOKEN=$(openssl rand -hex 24)   # what Claude's connector presents
export BODYMAP_UI_TOKEN=$(openssl rand -hex 24)    # what the web page presents
npm start                     # listens on 127.0.0.1:8104
```

Open `http://127.0.0.1:8104/#token=<UI token>` once. The page stores the token in that browser and removes it from the address bar.

| Variable | Default | Meaning |
|---|---|---|
| `BODYMAP_DATA_DIR` | required | Folder holding `body-map.json` (one file, written atomically, mode 600). |
| `BODYMAP_MCP_TOKEN` or `_FILE` | required | Bearer token for `/mcp`. At least 24 characters. |
| `BODYMAP_UI_TOKEN` or `_FILE` | required | Bearer token for `/api/*`. Must differ from the MCP token. |
| `BODYMAP_PORT` | 8104 | |
| `BODYMAP_HOST` | 127.0.0.1 | |
| `BODYMAP_CLAUDE_MAX_LEVEL` | 4 | Highest level Claude can give a layer it adds. |
| `BODYMAP_WEB_URL` | none | Shown inside the MCP App when it cannot load, as the fallback address. |
| `BODYMAP_DIST` | `./dist` | Where the built pages are. |

Secrets come from the environment or a file (`*_FILE`, for systemd credentials), never from argv.
The two tokens are separate on purpose: the token Claude's connector holds cannot open `/api`, and the web page's token cannot open `/mcp`.

## Checks

```sh
npm run check        # build, typecheck, 33 tests (domain laws, renderer, MCP over real HTTP, config)
npm run look         # real web page, real pointer, headless zen-beta, writes docs/screenshots/00-09
node scripts/look-mcp.mjs   # the MCP App inside a stand-in host (the SDK's AppBridge), writes 10-13
```

The look scripts need a Firefox-family browser on PATH (headless Chromium does not start in agent sessions on this machine).
`scripts/mutants.mjs` breaks one rule at a time in a scratch copy and expects a red test. Written, **not yet run**.

## How the MCP App is wired

`show_body_map` carries `_meta.ui.resourceUri = "ui://bodymap/view.html"`. The resource is `text/html;profile=mcp-app`, one file with inline script and style: no external origin, no `_meta.ui.csp` needed. It was loaded under the default MCP Apps CSP (`connect-src 'none'`, no eval) with no violation. The view calls `body_map_state` and `body_map_edit` through the host (`app.callServerTool`), so there is no network from the frame. If it cannot load, it says so and names the web page.
Built with `@modelcontextprotocol/server` 2.4, `@modelcontextprotocol/ext-apps` 2.0.4, stateless Streamable HTTP (`createMcpHandler`, one server per request).

`get_body_map` returns a PNG (front left, back right, numbered badges) and a text list: name, kind (tense, pinched, sharp), level, since when, who added it, plus the layers Alex cleared.
Sample: `docs/screenshots/get_body_map-sample.png`.

## Rendering and the Pi

The PNG is drawn as SVG and rasterised by `@resvg/resvg-wasm`: WebAssembly, so no native binary per architecture, nothing to patch for aarch64 under Nix, and no font file (badge digits are drawn as strokes). I chose it over skia-canvas and @napi-rs/canvas because those ship prebuilt per-platform `.node` files (a packaging risk on NixOS aarch64) for no gain on an 800 by 900 picture.
Measured on this x86 laptop: first render 91 ms, then about 23 ms each; a process that rendered 20 times held 208 MB RSS (whole Node process, measured once). On a Pi 5 I expect two to three times slower, still well under a second, and the same order of memory. That is an estimate, not a measurement. 1 GB spare is enough by a wide margin.

## Packaging for NixOS later (not written)

- Runtime: Node 24 (it runs the `.ts` sources directly, as kultura does), `src/`, `dist/`, production `node_modules` (zod, the MCP packages, resvg-wasm). No native module at runtime.
- Build: `buildNpmPackage` with an `npmDepsHash`, running `npm run build` (esbuild, build-time only). `typescript` and `@modelcontextprotocol/client` are dev-only.
- Service: DynamicUser, `StateDirectory=bodymap` as `BODYMAP_DATA_DIR`, `LoadCredential` for the two tokens (`*_FILE`), port 8104 on loopback, Caddy or Tailscale in front. Tailscale Funnel should expose `/mcp` only; `/` and `/api` stay tailnet-only.
- Memory limit of about 256 MB is plenty.

## What is not proven

- **Claude's own renderer.** Nothing here ran inside claude.ai or the phone app. The MCP App was tested in a stand-in host built from the official AppBridge, under the documented default CSP. The phone WebView, the safe-area handling and Pointer Events on a real touch screen are unchecked.
- **Authentication to the connector.** `/mcp` takes a static bearer token. Claude's connector screen documents OAuth. A static header is possible only where request-header connectors exist. If the custom connector needs OAuth, this server needs an OAuth layer (the plan routes /mcp through openGym's pattern). Not built.
- `_meta.ui.domain` is not set. Claude wants the first 32 hex chars of SHA-256 of the exact connector URL plus `.claudemcpcontent.com`, and only apps with their own CORS or OAuth need it.
- The mobile app caches `tools/list`: re-add the connector after tool changes.
- Mutation checks were not run. The rules' tests passed on the real code; whether each test can fail was shown only by the failures hit while developing (a wrong CSS selector, a stale-screen case, an eval probe the CSP blocked), not by deliberate breaks.
