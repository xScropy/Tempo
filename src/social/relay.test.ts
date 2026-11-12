import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, createWebSocketStream } from "ws";
import type { Snapshot } from "./protocol";
import { Mqtt, brokerOf, deriveSecrets, formatCode, newGroupCode, normalizeCode, relayClient, relayHost, type Link } from "./relay";
import { SocialServer, emptyState } from "./server";

// A real, independent MQTT broker (aedes) stands in for the public relay.
let http: Server;
let url: string;
const seenOnBroker: Buffer[] = [];

beforeAll(async () => {
  const { Aedes } = await import("aedes");
  const broker = await Aedes.createBroker();
  broker.on("publish", (p) => p.topic.startsWith("tempo/") && seenOnBroker.push(Buffer.from(p.payload as Buffer)));
  http = createServer();
  const wss = new WebSocketServer({ server: http });
  wss.on("connection", (socket) => broker.handle(createWebSocketStream(socket) as never));
  await new Promise<void>((r) => http.listen(0, r));
  url = `ws://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => http.close());

/** Request/response over a Link, like the app's client does. */
function rpc(link: Link) {
  let n = 0;
  const waiting = new Map<number, (m: { ok: boolean; data?: unknown; error?: string }) => void>();
  const pushes: Array<{ t: string }> = [];
  link.onmessage = (text) => {
    const m = JSON.parse(text);
    if ("re" in m) waiting.get(m.re)?.(m);
    else pushes.push(m);
  };
  const call = <T,>(t: string, d: unknown = {}) =>
    new Promise<T>((resolve, reject) => {
      const id = ++n;
      waiting.set(id, (m) => (m.ok ? resolve(m.data as T) : reject(new Error(m.error))));
      link.send(JSON.stringify({ id, t, d }));
    });
  return { call, pushes };
}
const until = async (fn: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe("group codes", () => {
  it("round-trips formatting and selects the broker", () => {
    const code = newGroupCode(1);
    expect(code).toMatch(/^2[A-Z0-9]{3}(-[A-Z0-9]{4}){3}$/);
    expect(formatCode(normalizeCode(code.toLowerCase()))).toBe(code);
    expect(brokerOf(code, ["a", "b"])).toBe("b");
    expect(() => brokerOf("nope")).toThrow(/not valid/);
    expect(() => brokerOf(newGroupCode(8))).toThrow(/not valid/);
  });
  it("derives the same secrets from the same code, different ones otherwise", async () => {
    const a = await deriveSecrets("1ABC-DEFG-HJKM-NPQR");
    const b = await deriveSecrets("1abcdefghjkmnpqr");
    const c = await deriveSecrets("1ABC-DEFG-HJKM-NPQS");
    expect(a.topic).toBe(b.topic);
    expect(a.topic).not.toBe(c.topic);
    expect(a.topic).toMatch(/^tempo\/v1\/[0-9a-f]{32}$/);
  });
});

describe("mqtt client against a real broker", () => {
  it("connects, subscribes, and delivers large binary payloads intact", async () => {
    const a = await Mqtt.connect(url);
    const b = await Mqtt.connect(url);
    const got: Array<[string, number]> = [];
    b.onMessage = (t, p) => got.push([t, p.length]);
    await b.subscribe("tempo/test/x");
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    a.publish("tempo/test/x", big);
    a.publish("tempo/test/x", new Uint8Array([1, 2, 3]));
    a.publish("tempo/test/other", new Uint8Array([9]));
    await until(() => got.length === 2);
    expect(got).toEqual([["tempo/test/x", 200_000], ["tempo/test/x", 3]]);
    a.close();
    b.close();
  });
  it("fails cleanly when nothing is listening", async () => {
    await expect(Mqtt.connect("ws://127.0.0.1:9", undefined, 2000)).rejects.toThrow();
  });
});

describe("a group over the relay", () => {
  it("two remote friends connect through the host, end-to-end encrypted", async () => {
    const code = newGroupCode(0);
    const brokers = [url];
    const server = new SocialServer(emptyState());
    const host = await relayHost(code, server, { brokers });

    const a = rpc(await relayClient(code, { brokers }));
    const b = rpc(await relayClient(code, { brokers }));
    const ra = await a.call<{ userId: string }>("register", { username: "youssef", displayName: "Youssef" });
    await b.call("register", { username: "ahmed", displayName: "Ahmed" });
    await a.call("friend.request", { username: "ahmed" });
    await until(() => b.pushes.some((p) => p.t === "notify"));
    const req = (await b.call<Snapshot>("state.get")).incoming[0]!;
    await b.call("friend.respond", { requestId: req.id, accept: true });
    await a.call("presence", { status: "focusing", mode: "pomodoro", plannedMs: 1_500_000, elapsedMs: 0 });
    await until(() => b.pushes.some((p) => p.t === "presence"));
    const friend = (await b.call<Snapshot>("state.get")).friends[0]!;
    expect(friend).toMatchObject({ id: ra.userId, username: "youssef" });
    expect(friend.presence.status).toBe("focusing");

    // the broker relayed everything, and understood none of it
    expect(seenOnBroker.length).toBeGreaterThan(10);
    const wire = Buffer.concat(seenOnBroker).toString("latin1");
    for (const secret of ["youssef", "ahmed", "register", "focusing", "username"]) expect(wire).not.toContain(secret);
    host.close();
  });

  it("a wrong code cannot reach the group, and a missing host is reported clearly", async () => {
    const brokers = [url];
    const server = new SocialServer(emptyState());
    const host = await relayHost(newGroupCode(0), server, { brokers });
    await expect(relayClient(newGroupCode(0), { brokers, waitMs: 1200 })).rejects.toThrow(/host is not online/);
    expect(Object.keys(server.state.users)).toHaveLength(0);
    host.close();
  });

  it("clients are told to reconnect after the host restarts", async () => {
    const code = newGroupCode(0);
    const brokers = [url];
    const server = new SocialServer(emptyState());
    let host = await relayHost(code, server, { brokers });
    const link = await relayClient(code, { brokers });
    const c = rpc(link);
    await c.call("register", { username: "omar", displayName: "Omar" });
    let closed = false;
    link.onclose = () => (closed = true);
    host.close();
    host = await relayHost(code, new SocialServer(server.state), { brokers });
    link.send(JSON.stringify({ id: 99, t: "state.get", d: {} }));
    await until(() => closed);
    // a fresh connection works and the account survived
    const again = rpc(await relayClient(code, { brokers }));
    await expect(again.call("register", { username: "omar", displayName: "Omar" })).rejects.toThrow(/taken/);
    host.close();
  });
});
