// A stand-in for Claude's chat window, built from the official host side of the MCP Apps SDK (AppBridge).
// It connects to the real server over HTTP, opens the show_body_map UI resource in an iframe whose document
// carries the default MCP Apps CSP (no network at all), and forwards the app's tool calls like a host does.
// Test tool only. Not shipped, not served by the real server.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { AppBridge, PostMessageTransport, getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

const DEFAULT_CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'";
const params = new URLSearchParams(location.search);
const token = params.get("token") ?? "";

const client = new Client({ name: "stand-in-host", version: "0" });
await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", location.origin), { requestInit: { headers: { authorization: "Bearer " + token } } }));

const w = window as unknown as Record<string, unknown>;
// What the model can do: call any tool the host would list for it.
w.hostCall = async (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
w.hostTools = async () => (await client.listTools()).tools;

const { tools } = await client.listTools();
const show = tools.find((t) => t.name === "show_body_map");
const uri = show ? getToolUiResourceUri(show) : undefined;
if (!uri) throw new Error("show_body_map has no ui resource");
const resource = await client.readResource({ uri });
const content = resource.contents[0] as { mimeType?: string; text?: string };
if (content.mimeType !== "text/html;profile=mcp-app") throw new Error("wrong mime type " + content.mimeType);
w.resourceMime = content.mimeType;

const html = (content.text ?? "").replace("<head>", '<head><meta http-equiv="Content-Security-Policy" content="' + DEFAULT_CSP + '">');
const frame = document.createElement("iframe");
frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
frame.style.cssText = "width:100%;height:" + (params.get("h") ?? "1200") + "px;border:0";
document.body.append(frame);

const bridge = new AppBridge(client, { name: "stand-in-host", version: "0" }, { openLinks: {}, serverTools: {}, logging: {} }, { hostContext: { theme: "light", platform: "mobile", displayMode: "inline", safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } } });
bridge.oninitialized = async () => {
  w.viewInitialized = true;
  bridge.sendToolInput({ arguments: {} });
  bridge.sendToolResult(await client.callTool({ name: "show_body_map", arguments: {} }) as never);
};
frame.srcdoc = html;
await bridge.connect(new PostMessageTransport(frame.contentWindow as Window, frame.contentWindow as Window));
w.hostReady = true;
