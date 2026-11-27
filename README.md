# bodymap

Alex paints where he feels tension, pinching or pain on a front and back drawing of a man's muscles.
Claude reads it before it plans a session. One small Node service, two doors, and an Android app that talks to the second one:

- **MCP App** at `/mcp/<secret>`. Claude shows the interactive canvas inside the chat (`show_body_map`), reads the map (`get_body_map`) and can add a layer from words (`add_layer`).
- **Plain web page** at `/`, and its `/api/*`. The same interface and the same API, for when the MCP App does not render.
- **Android app** (`app/`, see "Android app" below). The same interface as the web page in a Capacitor shell, talking to `/api/*` over the tailnet.

The one interface (`src/ui`) is dark, made for a phone (every touch target 48 px or more, no animation anywhere) and has three thin entry points: `web.ts` (the page), `mcpview.ts` (the MCP App) and `app/src/main.ts` (Android). Each gives it a `Backend` and nothing else.
The figure is `assets/figure/front.svg` and `back.svg` (CC BY-SA 4.0, see `assets/figure/NOTICE.md`). The app, the web page, the MCP view and the PNG that `get_body_map` returns all draw that same file: `npm run build` inlines it into `src/figure-assets.ts` (esbuild's text loader), so nothing reads a file at runtime.

## The connector URL

Claude's connector screen documents OAuth. This service has none. The connector is added without it, and the secret sits in the URL path:

```
https://gym.tailcab34c.ts.net/bodymap/mcp/<secret>
```

The proxy (Caddy) removes `/bodymap`, so the service sees `/mcp/<secret>`. The secret is the value of `BODYMAP_MCP_TOKEN`.
A request to `/mcp/<secret>` counts as `Authorization: Bearer <secret>`. The header still works on `/mcp`, for local tools and tests.

- A wrong or missing secret answers exactly like an unknown path: 404 and `{"error":"not found"}`, the same headers. Never 401, never a `www-authenticate` header, so a stranger learns nothing about the door. The path secret decides: a wrong path secret is not rescued by a right header.
- The secret is compared in constant time (SHA-256 of both sides, then `timingSafeEqual`).
- The service rewrites the request path to `/mcp` before the MCP code sees it, and logs only an error's class name. The secret and the request path are never written to a log, an error or a tool result.
- The web page and `/api` are tailnet only. The proxy must not let them through Funnel: publish only `/bodymap/mcp/*`. Under Funnel they answer like any other path the gate refuses.

Security note: **the URL is the credential.** Anyone who has it has full access to the map: read, add, lower and delete layers (the app's own tools take a grant that sits in the app page, which the URL holder can fetch). The "Claude cannot lower or delete" law holds for the model's tool list only (the edit tools are app-only), and it is not verified that Claude's host really hides app-only tools from the model. It is in the connector settings, in the phone's history if pasted there, and in any log that records request paths. The proxy must not log the path of `/bodymap/mcp/*` (Caddy: no access log for that route, or filter the `uri` field). To rotate: write a new value into the token file, restart the service, delete the connector in Claude and add it again with the new URL.
Make a secret with 32 random bytes in base64url (43 characters):

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

The token may hold only letters, digits and `. _ ~ -` (base64url or hex), so it needs no escaping in a path. The service refuses to start otherwise.

## The rules (each one has a test)

1. Only Alex lowers a slider or deletes a layer, as far as the MODEL goes: Claude's own tools are `show_body_map`, `get_body_map`, `add_layer`. None of them can lower, clear or delete. The tools that can (`body_map_edit`, `body_map_state`) are `visibility: ["app"]`, so hosts must keep them out of the model's tool list, and they also demand a grant that exists only inside the app's own HTML.
2. `add_layer` only creates. A name that exists, cleared or not, is refused and nothing changes.
3. Claude's level is capped (`BODYMAP_CLAUDE_MAX_LEVEL`, default 4). Alex can raise it.
4. The picture holds only layers above 0, each at opacity level / 10. Level 0 = cleared, greyed in the list, absent from the picture, remembered in the text list.
5. An edit made from a screen that is older than the layer is refused (HTTP 409), and the screen refreshes.
6. A damaged data file stops the server. It is never overwritten.

## Run it

```sh
npm ci
npm run build                 # src/figure-assets.ts (the drawing, inlined), dist/view.html (MCP App) and dist/web.html, each one self-contained file
export BODYMAP_DATA_DIR=$PWD/data
export BODYMAP_MCP_TOKEN=$(openssl rand -hex 24)   # what Claude's connector presents
export BODYMAP_UI_TOKEN=$(openssl rand -hex 24)    # what the web page presents
npm start                     # listens on 127.0.0.1:8104
```

Open `http://127.0.0.1:8104/#token=<UI token>` once. The page stores the token in that browser and removes it from the address bar.

The page works under a path prefix that the proxy removes (`https://host/bodymap/`): it only uses relative URLs (`api/state`, `api/edit`). A test reads the built HTML and fails on any absolute path. The proxy must send `/bodymap` to `/bodymap/`. If it does not, the page adds the slash itself, so it still works.

| Variable | Default | Meaning |
|---|---|---|
| `BODYMAP_DATA_DIR` | required | Folder holding `body-map.json` (one file, written atomically, mode 600). Created if missing. |
| `BODYMAP_MCP_TOKEN` or `BODYMAP_MCP_TOKEN_FILE` | required | The connector secret: the `<secret>` in `/mcp/<secret>`, and the bearer token for `/mcp`. At least 24 characters, letters, digits and `. _ ~ -` only. The file wins when both are set. |
| `BODYMAP_UI_TOKEN` or `BODYMAP_UI_TOKEN_FILE` | required | Bearer token for `/api/*`. Must differ from the MCP token. |
| `BODYMAP_PORT` | 8104 | |
| `BODYMAP_HOST` | 127.0.0.1 | One address. `0.0.0.0`, `::` and `*` are refused: the service never listens on every interface. |
| `BODYMAP_ALLOWED_HOSTS` | none | Comma separated host names (no port, no scheme), for example `gym.tailcab34c.ts.net`. When set, the `Host` header and any `Origin` header must name one of them (or localhost, 127.0.0.1, [::1], for health checks), else the answer is the plain 404. When empty there is no host check: the secret is the only gate. The MCP SDK offers this check but has it off, and this service did none before. |
| `BODYMAP_CLAUDE_MAX_LEVEL` | 4 | Highest level Claude can give a layer it adds. |
| `BODYMAP_WEB_URL` | none | Shown inside the MCP App when it cannot load, as the fallback address. |
| `BODYMAP_DIST` | `./dist` | Where the built pages are. |

Secrets come from the environment or a file (`*_FILE`, for systemd credentials), never from argv.
The two tokens are separate on purpose: the token Claude's connector holds cannot open `/api`, and the web page's token cannot open `/mcp`.

## Checks

```sh
npm run check               # build, typecheck, __TESTS__ tests: domain laws, renderer and figure, the interface's controller and HTTP backend, MCP over real HTTP, config, secret path, prefix, real process
npm run look                # the real interface with real touch pointers at 412 x 915, headless zen-beta, writes docs/screenshots/app-01..05
node scripts/look-mcp.mjs   # the MCP App inside a stand-in host (the SDK's AppBridge), writes 10-13 and get_body_map-sample.png
```

The look scripts need a Firefox-family browser on PATH (headless Chromium does not start in agent sessions on this machine). `npm run look` also measures: touch targets of 48 px and more, the slider thumb, no transition or animation anywhere, the weakest text contrast on screen, safe-area insets, a 360 x 640 phone, and where a stroke starts and ends compared with where the finger went (within 1.5 figure units).

`scripts/mutants.mjs` breaks one rule at a time in a scratch copy and expects a red test. Written, **not yet run** (its anchor for the agent door was updated for the path secret). `GET /healthz` answers `{"ok":true}` without a token, for a local health check; it is not under `/mcp` any more.

## How the MCP App is wired

`show_body_map` carries `_meta.ui.resourceUri = "ui://bodymap/view.html"`. The resource is `text/html;profile=mcp-app`, one file with inline script and style: no external origin, no `_meta.ui.csp` needed. It was loaded under the default MCP Apps CSP (`connect-src 'none'`, no eval) with no violation. The view calls `body_map_state` and `body_map_edit` through the host (`app.callServerTool`), so there is no network from the frame. If it cannot load, it says so and names the web page.
Built with `@modelcontextprotocol/server` 2.4, `@modelcontextprotocol/ext-apps` 2.0.4, stateless Streamable HTTP (`createMcpHandler`, one server per request).

`get_body_map` returns a PNG (front left, back right, numbered badges) and a text list: name, kind (tense, pinched, sharp), level, since when, who added it, plus the layers Alex cleared.
Sample: `docs/screenshots/get_body_map-sample.png`.

## Android app

`app/` is a Capacitor 8 shell around the same interface as the web page. Package `dev.bodymap.app`, name "Body map", minSdk 24, target and compile SDK 36, permission INTERNET only (the build also adds androidx's own `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`, a signature permission only this app can hold). It talks to `/api/*` of the server over the tailnet. Requests go through Capacitor's native HTTP plugin, so the server needs no CORS change and the WebView's mixed-content rules do not apply. The token sits in Capacitor Preferences (the app's private storage, excluded from backups). Release builds refuse cleartext http; the debug build allows it to `10.0.2.2` only (the emulator's name for the host machine).

### Build

Nothing is installed system wide. `app/shell.nix` gives a shell with JDK 21 (Capacitor 8 needs 21, not 17), gradle 8.14, node and an Android SDK (platform 36, build-tools 35.0.0, platform-tools) from nixpkgs. It accepts the Android SDK licence for that shell only.

```sh
scripts/android-build.sh            # signed release APK -> dist-android/bodymap-<version>.apk and .sha256
scripts/android-build.sh debug      # debug APK, for the emulator test
```

The script enters the shell itself, runs gradle with `--no-daemon --max-workers=2` and `org.gradle.jvmargs=-Xmx2g`, and caps itself at 8 GB memory and 300 % CPU with `systemd-run` (set `BODYMAP_NO_LIMITS=1` to skip). The first run downloads about 1.3 GB of SDK and Maven artifacts. Gradle's cache and the SDK user directory live in `BODYMAP_ANDROID_SCRATCH` (default `~/.cache/bodymap-android`); delete it any time. `gradle --stop` runs at the end.

The release key is made once, on the first release build, in `~/.local/share/bodymap-android/` (`keystore.jks` and `keystore.properties`, both mode 600, folder mode 700). The passwords are generated into the properties file, handed to keytool as a file, and read by gradle from that file. They are never in the repo, argv or the environment. **Back that folder up.** An APK signed with another key cannot be installed over this one, and the old app would have to be uninstalled first, which deletes its saved token.

### Install, set up, update

1. Copy `dist-android/bodymap-<version>.apk` to the phone (`adb install -r`, or any file transfer and tap it; Android asks once to allow installs from that app). Check `sha256sum -c bodymap-<version>.apk.sha256` on the way.
2. Open the app. First run asks for the server address (prefilled with `https://gym.tailcab34c.ts.net/bodymap/`) and the web token (`BODYMAP_UI_TOKEN`). The phone must be on the tailnet.
3. Or open `bodymap://setup?server=<url>&token=<token>` on the phone (a link in a note, a QR code, `adb shell am start -a android.intent.action.VIEW -d '<link>'`). It fills the two fields; Alex still taps Connect, so a stranger's link cannot point the app at a server by itself.
4. Change the server or forget the token under the info button (About).
5. **To update:** raise `bodymap.versionCode` in `app/package.json` (Android refuses an install whose versionCode is not higher; `version` is only the label), build, install over the old one. The token stays.

About shows the version and the figure's attribution (from `assets/figure/NOTICE.md`).

### Tests for the app

```sh
scripts/android-emulator-test.sh     # needs /dev/kvm and ~2.3 GB more SDK (emulator and a system image), one emulator, 10 minutes at most
```

It starts the real service on a localhost port with test tokens and a throwaway data dir, boots a headless x86_64 emulator, installs the debug APK, opens the setup link, taps Connect, adds a mark, paints a stroke and moves a slider with `adb input`, and then reads `/api/state` to see what the service holds. It kills the emulator by pid and deletes its scratch dir at the end.

## Rendering and the Pi

The PNG is drawn as SVG and rasterised by `@resvg/resvg-wasm`: WebAssembly, so no native binary per architecture, nothing to patch for aarch64 under Nix, and no font file (badge digits are drawn as strokes). I chose it over skia-canvas and @napi-rs/canvas because those ship prebuilt per-platform `.node` files (a packaging risk on NixOS aarch64) for no gain on an 800 by 710 picture.
Measured on this x86 laptop (2026-11-27, with the detailed muscle drawing, other programs running): first render 211 ms, then about 90 ms each, 194 MB RSS for a Node process that rendered 21 times (measured once). The old stick figure took 23 ms. On a Pi 5 I expect two to three times slower, still well under a second, and the same order of memory. That is an estimate, not a measurement. 1 GB spare is enough by a wide margin.

## Building for NixOS

The commands that produce `dist/` (the only build output; nothing else is generated):

```sh
npm ci --ignore-scripts      # exactly package-lock.json; the Nix build hook does the same
npm run build                # node scripts/build.mjs: dist/view.html (MCP App) and dist/web.html (web page)
```

What was measured on this x86 laptop, 2026-11-25:

- `npm ci --offline --ignore-scripts` and `npm run build` ran inside `unshare -rn` (no network) from a clean checkout and the local npm cache. The build fetches nothing: esbuild only reads `src/ui` and bundles from `node_modules`.
- `dist/*.html` are byte for byte the same on a second build (SHA-256 compared).
- A `buildNpmPackage` of this repo built in the Nix sandbox (nixpkgs `nodejs_24`, 24.22.2) with the hash below. The result started from the Nix store path, listened on 127.0.0.1, and answered `/mcp/<secret>`. Its `dist/` matched the npm build.

```nix
pkgs.buildNpmPackage {
  pname = "bodymap"; version = "0.1.0";
  src = ./.;                               # without node_modules, dist, data, .git
  nodejs = pkgs.nodejs_24;
  npmDepsHash = "sha256-pumTFqJqW2Je+zNLSHN870JgvMbK9ROZa0jePc5t+Fc=";
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/bodymap
    cp -r package.json src dist $out/lib/bodymap/
    npm prune --omit=dev --no-audit --no-fund
    cp -r node_modules $out/lib/bodymap/
    runHook postInstall
  '';
}
```

Run it with `node --disable-warning=ExperimentalWarning $out/lib/bodymap/src/main.ts` (Node 24 strips the types itself; it never strips files under `node_modules`, and there are none to strip).

Inputs of `npmDepsHash`: only `package-lock.json` (the `resolved` URL and `integrity` of each of its 70 entries; every URL is on registry.npmjs.org, no git or tarball dependencies). Recompute after any `npm install` or `npm update`:

```sh
nix run nixpkgs#prefetch-npm-deps -- package-lock.json
```

`package.json` scripts do not enter the hash. Edit `package.json` without touching dependencies and the hash stays.

Native binaries, all build-time only:

- `esbuild` runs a prebuilt Go binary from the optional package `@esbuild/<os>-<cpu>`. The lockfile lists every platform, including `@esbuild/linux-arm64` for Berry, each with an `integrity`. It is fetched by the deps derivation, never at build time. The binary is statically linked, so NixOS needs no patching. The aarch64 build was **not run**.
- `typescript` 7 also ships native binaries (`@typescript/typescript-<os>-<cpu>`). Only `npm run typecheck` uses them, not `npm run build`, so the Nix build does not need them to run.
- The runtime has no native module: the picture is rasterised by `@resvg/resvg-wasm` (WebAssembly).
- `npm prune --omit=dev` left `node_modules/@esbuild`, `@typescript` and `@types` in the output (32 MB in all). Delete them in `installPhase` if the size matters.

Service shape for the module: DynamicUser, `StateDirectory=bodymap` as `BODYMAP_DATA_DIR`, `LoadCredential` for the two tokens (`BODYMAP_MCP_TOKEN_FILE`, `BODYMAP_UI_TOKEN_FILE`), `BODYMAP_HOST=127.0.0.1`, `BODYMAP_PORT=8104`, `BODYMAP_ALLOWED_HOSTS=gym.tailcab34c.ts.net`, memory limit about 256 MB. Caddy: `/bodymap/*` strips the prefix and proxies to 127.0.0.1:8104; `/bodymap` redirects to `/bodymap/`; the Funnel gate lets only `/bodymap/mcp/*` through; no access log for `/bodymap/mcp/*`.

## What is not proven

- **Claude's own renderer.** Nothing here ran inside claude.ai or the phone app. The MCP App was tested in a stand-in host built from the official AppBridge, under the documented default CSP.
- **A real phone.** The Android app was run in an x86_64 emulator (API 36, Google APIs image) with `adb` touches, not on hardware. Not checked: the Tailscale path from a phone, the https certificate of the real server, a different WebView version, a slow network, a gesture-navigation phone's real insets, the system keyboard (the test types with `adb input text`), install over an older version (versionCode), and the release APK running at all: the release build was inspected (signature, manifest, size) and built from the same sources as the debug build that ran, but it was not started.
- **Authentication to the connector.** The decision is no OAuth: the secret sits in the URL path (see "The connector URL"). Whether Claude's custom connector accepts a URL that carries a path secret, and does not demand OAuth discovery, is untested. Constant-time comparison is read from the code (`timingSafeEqual` on SHA-256 digests), not measured. The tests show wrong secrets get the unknown-path answer; no mutation check was run on the new tests (the mutation script was not run, by rule), so whether each test can fail is shown by the negative cases inside them, not by deliberate breaks.
- **The proxy.** The Caddy rules, the Funnel allowlist and the no-path-logging rule live in the Nix module. A stand-in proxy in `test/door.test.ts` proves the prefix handling, not Caddy itself.
- `_meta.ui.domain` is not set. Claude wants the first 32 hex chars of SHA-256 of the exact connector URL plus `.claudemcpcontent.com`, and only apps with their own CORS or OAuth need it.
- The mobile app caches `tools/list`: re-add the connector after tool changes.
- Mutation checks were not run. The rules' tests passed on the real code; whether each test can fail was shown only by the failures hit while developing (a wrong CSS selector, a stale-screen case, an eval probe the CSP blocked), not by deliberate breaks.
