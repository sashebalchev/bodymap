// The agent door behind a proxy that publishes it on the internet: the secret sits in the URL path.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { MCP_TOKEN, startServer, UI_TOKEN, type Running } from "./server-helpers.ts";

let s: Running;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

const post = (path: string, headers: Record<string, string> = {}) =>
  fetch(s.url + path, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });

/** What an unknown path answers: the reference every refusal has to match, byte for byte. */
async function shape(r: Response): Promise<string> {
  const keep = ["content-type", "cache-control", "www-authenticate", "x-content-type-options", "referrer-policy"];
  return r.status + " " + keep.map((h) => h + "=" + r.headers.get(h)).join(";") + " " + (await r.text());
}
const unknown = async () => shape(await fetch(s.url + "/no-such-door"));

test("the secret in the path opens the MCP door, with no header at all", async () => {
  const client = await s.pathClient(MCP_TOKEN);
  const { tools } = await client.listTools();
  assert.ok(tools.some((t) => t.name === "get_body_map"));
});

test("the header on /mcp still opens it", async () => {
  assert.equal((await post("/mcp", { authorization: "Bearer " + MCP_TOKEN })).status, 200);
});

test("a wrong secret in the path answers exactly like an unknown path: 404, same body, no 401, no hint", async () => {
  const want = await unknown();
  assert.match(want, /^404 /);
  for (const bad of ["x".repeat(MCP_TOKEN.length), MCP_TOKEN.slice(0, -1), MCP_TOKEN + "x", UI_TOKEN, "", "health"]) {
    assert.equal(await shape(await post("/mcp/" + bad)), want, "secret variant " + bad.length);
  }
  assert.equal(await shape(await post("/mcp/" + MCP_TOKEN + "/extra")), want);
  assert.equal(await shape(await post("/mcp/" + MCP_TOKEN + "/")), want);
});

test("a missing or wrong header on /mcp answers exactly like an unknown path too", async () => {
  const want = await unknown();
  assert.equal(await shape(await post("/mcp")), want);
  assert.equal(await shape(await post("/mcp", { authorization: "Bearer nope" })), want);
  assert.equal(await shape(await post("/mcp", { authorization: "Basic " + MCP_TOKEN })), want);
});

test("the secret in a header on the wrong path opens nothing, and a wrong path secret is not rescued by a right header", async () => {
  const want = await unknown();
  const rightHeader = { authorization: "Bearer " + MCP_TOKEN };
  assert.equal(await shape(await post("/mcp/wrong-secret-wrong-secret-wrong", rightHeader)), want);
  assert.equal(await shape(await post("/mcp/", rightHeader)), want);
  assert.equal(await shape(await post("/other", rightHeader)), want);
  assert.equal(await shape(await post("/mcp-" + MCP_TOKEN)), want);
  assert.equal((await s.api("/api/state", { token: MCP_TOKEN })).status, 401, "the agent secret never opens the web API");
});

test("the secret in the path does not open the web API or the page", async () => {
  assert.equal(await shape(await fetch(s.url + "/" + MCP_TOKEN)), await unknown());
  assert.equal((await fetch(s.url + "/api/" + MCP_TOKEN)).status, 401, "/api answers 401 to anyone without the web token; it is tailnet only");
  assert.equal((await fetch(s.url + "/api/state?token=" + MCP_TOKEN)).status, 401);
  assert.equal((await fetch(s.url + "/api/state?token=" + UI_TOKEN)).status, 401, "a token in the query string is no token");
});

test("allowed hosts: the public host passes, a rebinding host and a foreign Origin get the unknown-path answer", async () => {
  const guarded = await startServer({ allowedHosts: ["gym.tailcab34c.ts.net"] });
  try {
    const raw = (headers: Record<string, string>, path = "/mcp/" + MCP_TOKEN) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const u = new URL(guarded.url);
      const req = request({ host: u.hostname, port: u.port, path, method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    });
    assert.equal((await raw({ host: "gym.tailcab34c.ts.net" })).status, 200);
    assert.equal((await raw({ host: "GYM.tailcab34c.ts.net:443", origin: "https://gym.tailcab34c.ts.net" })).status, 200);
    assert.equal((await raw({ host: "127.0.0.1:8104" })).status, 200, "loopback names always pass, for health checks");
    const refused = await raw({ host: "evil.example" });
    assert.equal(refused.status, 404);
    assert.equal(refused.body, JSON.stringify({ error: "not found" }));
    assert.equal((await raw({ host: "gym.tailcab34c.ts.net", origin: "https://evil.example" })).status, 404);
    assert.equal((await raw({ host: "gym.tailcab34c.ts.net", origin: "null" })).status, 404);
    assert.equal((await raw({ host: "evil.example" }, "/api/state")).status, 404);
  } finally {
    await guarded.close();
  }
});

test("with no allowed hosts set, any Host is accepted: the secret is the only gate", async () => {
  const fetched = await fetch(s.url + "/mcp/" + MCP_TOKEN, { method: "POST", headers: { host: "anything.example", "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
  assert.notEqual(fetched.status, 404);
});

// A stand-in for Caddy: /bodymap/* goes to the service with the prefix removed.
async function stripProxy(target: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const path = req.url ?? "/";
    if (!path.startsWith("/bodymap/")) { res.writeHead(404).end("not found"); return; }
    const out = request(new URL(target + path.slice("/bodymap".length)), { method: req.method, headers: req.headers }, (back) => {
      res.writeHead(back.statusCode ?? 502, back.headers);
      back.pipe(res);
    });
    req.pipe(out);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: "http://127.0.0.1:" + (server.address() as AddressInfo).port, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("behind a prefix-stripping proxy: the page, /api and the MCP secret path all work under /bodymap/", async () => {
  const proxy = await stripProxy(s.url);
  try {
    assert.equal((await fetch(proxy.url + "/bodymap/")).status, 200);
    assert.equal((await fetch(proxy.url + "/bodymap/api/state", { headers: { authorization: "Bearer " + UI_TOKEN } })).status, 200);
    assert.equal((await fetch(proxy.url + "/bodymap/api/state")).status, 401);
    assert.equal((await fetch(proxy.url + "/bodymap/mcp/wrong-secret-wrong-secret-wrong", { method: "POST", body: "{}" })).status, 404);
    const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
    const client = new Client({ name: "proxy", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(proxy.url + "/bodymap/mcp/" + MCP_TOKEN)));
    try {
      assert.ok((await client.listTools()).tools.length >= 3);
    } finally {
      await client.close();
    }
  } finally {
    await proxy.stop();
  }
});
