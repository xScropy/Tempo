import { tr } from "@/i18n";
/**
 * Internet connectivity without anyone running a server.
 *
 * One friend's app hosts the group (it runs the same `SocialServer`), and
 * everyone else reaches it through a public MQTT message broker instead of a
 * direct connection — which is what makes it work across different networks.
 *
 * The broker is a third party, so it is treated as untrusted:
 *  - every frame is encrypted with AES-256-GCM using a key derived from the
 *    group code, so the broker only ever relays ciphertext;
 *  - the topic is derived from the same code and is unguessable without it.
 * The broker can still see that *something* is exchanged, when, and how big.
 */
import type { SocialServer } from "./server";

/** Public brokers, tried in this order by the host. The group code records which one is in use. */
export const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt", "wss://test.mosquitto.org:8081/mqtt"];

export type WsCtor = new (url: string, protocols?: string | string[]) => WebSocket;

export interface Link {
  send(text: string): void;
  close(): void;
  onmessage: ((text: string) => void) | null;
  onclose: (() => void) | null;
}

// ---- minimal MQTT 3.1.1 client (QoS 0) ----------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b |= 0x80;
    out.push(b);
  } while (n > 0);
  return out;
}
const str = (s: string): number[] => {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
};
function packet(type: number, ...parts: Array<number[] | Uint8Array>): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const head = [type, ...varint(len)];
  const out = new Uint8Array(head.length + len);
  out.set(head);
  let o = head.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export class Mqtt {
  onMessage: ((topic: string, payload: Uint8Array) => void) | null = null;
  onClose: (() => void) | null = null;
  private buf = new Uint8Array(0);
  private nextId = 1;
  private acks = new Map<number, () => void>();
  private ping: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  private constructor(private ws: WebSocket) {}

  static connect(url: string, WS: WsCtor = WebSocket, timeoutMs = 10_000): Promise<Mqtt> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WS(url, "mqtt");
      } catch (e) {
        return reject(e instanceof Error ? e : new Error(String(e)));
      }
      ws.binaryType = "arraybuffer";
      const m = new Mqtt(ws);
      let done = false;
      const fail = (why: string) => {
        if (done) return;
        done = true;
        try {
          ws.close();
        } catch {
          /* already closed */
        }
        reject(new Error(why));
      };
      const timer = setTimeout(() => fail(tr("The relay did not answer")), timeoutMs);
      ws.onopen = () => {
        const id = `tempo-${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;
        // protocol "MQTT" level 4, clean session, 60 s keep-alive
        ws.send(packet(0x10, str("MQTT"), [4, 0x02, 0, 60], str(id)));
      };
      ws.onerror = () => fail(tr("Could not reach the relay"));
      ws.onclose = () => {
        fail(tr("The relay closed the connection"));
        m.shutdown();
      };
      ws.onmessage = (ev) => {
        m.feed(new Uint8Array(ev.data as ArrayBuffer), (rc) => {
          clearTimeout(timer);
          if (rc !== 0) return fail(tr("The relay refused the connection"));
          done = true;
          m.ping = setInterval(() => ws.readyState === 1 && ws.send(packet(0xc0)), 30_000);
          resolve(m);
        });
      };
    });
  }

  private shutdown() {
    if (this.closed) return;
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.onClose?.();
  }

  /** Parses as many complete packets as the buffer holds; frames may split or batch packets. */
  private feed(chunk: Uint8Array, onConnack: (rc: number) => void) {
    const joined = new Uint8Array(this.buf.length + chunk.length);
    joined.set(this.buf);
    joined.set(chunk, this.buf.length);
    let o = 0;
    for (;;) {
      if (joined.length - o < 2) break;
      let len = 0;
      let mult = 1;
      let i = o + 1;
      let complete = false;
      while (i < joined.length && i < o + 5) {
        const b = joined[i++]!;
        len += (b & 0x7f) * mult;
        mult *= 128;
        if (!(b & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete || joined.length - i < len) break;
      const type = joined[o]! >> 4;
      const body = joined.subarray(i, i + len);
      if (type === 2) onConnack(body[1] ?? 1);
      else if (type === 9) {
        const id = (body[0]! << 8) | body[1]!;
        this.acks.get(id)?.();
        this.acks.delete(id);
      } else if (type === 3) {
        const tl = (body[0]! << 8) | body[1]!;
        const qos = (joined[o]! >> 1) & 3;
        const topic = dec.decode(body.subarray(2, 2 + tl));
        this.onMessage?.(topic, body.slice(2 + tl + (qos ? 2 : 0)));
      }
      o = i + len;
    }
    this.buf = joined.slice(o);
  }

  subscribe(topic: string, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++ & 0xffff || 1;
      const timer = setTimeout(() => (this.acks.delete(id), reject(new Error(tr("The relay did not confirm the subscription")))), timeoutMs);
      this.acks.set(id, () => (clearTimeout(timer), resolve()));
      this.ws.send(packet(0x82, [id >> 8, id & 0xff], str(topic), [0]));
    });
  }

  publish(topic: string, payload: Uint8Array) {
    if (this.ws.readyState === 1) this.ws.send(packet(0x30, str(topic), payload));
  }

  get open() {
    return !this.closed && this.ws.readyState === 1;
  }

  close() {
    try {
      if (this.ws.readyState === 1) this.ws.send(packet(0xe0));
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.shutdown();
  }
}

// ---- group codes and encryption -------------------------------------------------

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A new group code: broker digit + 15 random characters (~74 bits), shown as XXXX-XXXX-XXXX-XXXX. */
export function newGroupCode(brokerIndex: number): string {
  const body = Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => ALPHABET[b % ALPHABET.length]).join("");
  return formatCode(`${brokerIndex + 1}${body}`);
}
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const formatCode = (code: string) => normalizeCode(code).replace(/(.{4})(?=.)/g, "$1-");
export function brokerOf(code: string, brokers = BROKERS): string {
  const n = normalizeCode(code);
  const url = brokers[Number(n[0]) - 1];
  if (n.length !== 16 || !url) throw new Error(tr("That group code is not valid. It looks like 1ABC-DEFG-HJKM-NPQR."));
  return url;
}

interface Secrets {
  key: CryptoKey;
  topic: string;
}

/** Derives the encryption key and the topic from the code (PBKDF2, so a code cannot be brute-forced cheaply). */
export async function deriveSecrets(code: string): Promise<Secrets> {
  const material = await crypto.subtle.importKey("raw", enc.encode(normalizeCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode("tempo-relay-v1"), iterations: 150_000 }, material, 384));
  const key = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  const topic = `tempo/v1/${Array.from(bits.slice(32), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return { key, topic };
}

async function seal(key: CryptoKey, obj: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function unseal<T>(key: CryptoKey, data: Uint8Array): Promise<T | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(0, 12) }, key, data.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null; // not ours, or tampered with: ignore
  }
}

interface Frame {
  /** virtual connection id */
  c: string;
  /** open, ack, message, ping, pong, bye */
  k: "o" | "a" | "m" | "p" | "q" | "b";
  d?: string;
}

const HOST_SILENT_MS = 70_000;
const CLIENT_SILENT_MS = 80_000;

// ---- joining a group ------------------------------------------------------------

/** Opens a virtual connection to the group's host through the relay. */
export async function relayClient(code: string, opts: { WS?: WsCtor; brokers?: string[]; waitMs?: number } = {}): Promise<Link> {
  const url = brokerOf(code, opts.brokers);
  const { key, topic } = await deriveSecrets(code);
  const mqtt = await Mqtt.connect(url, opts.WS);
  const conn = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const up = (f: Omit<Frame, "c">) => void seal(key, { c: conn, ...f }).then((b) => mqtt.publish(`${topic}/u`, b));
  let lastHeard = Date.now();
  let acked: (() => void) | null = null;
  let closed = false;
  const link: Link = {
    onmessage: null,
    onclose: null,
    send: (text) => up({ k: "m", d: text }),
    close: () => {
      if (closed) return;
      closed = true;
      up({ k: "b" });
      clearInterval(beat);
      setTimeout(() => mqtt.close(), 150);
      link.onclose?.();
    },
  };
  mqtt.onMessage = (_t, payload) =>
    void unseal<Frame>(key, payload).then((f) => {
      if (!f || f.c !== conn || closed) return;
      lastHeard = Date.now();
      if (f.k === "a") acked?.();
      else if (f.k === "m" && f.d != null) link.onmessage?.(f.d);
      else if (f.k === "b") link.close(); // the host does not know us (it restarted): reconnect from scratch
    });
  mqtt.onClose = () => link.close();
  const beat = setInterval(() => {
    if (Date.now() - lastHeard > HOST_SILENT_MS) return link.close();
    up({ k: "p" });
  }, 20_000);

  await mqtt.subscribe(`${topic}/d/${conn}`);
  await new Promise<void>((resolve, reject) => {
    const knock = setInterval(() => up({ k: "o" }), 1500);
    const timer = setTimeout(() => {
      clearInterval(knock);
      link.close();
      reject(new Error(tr("The group's host is not online right now. The group works while the person who started it has Tempo open.")));
    }, opts.waitMs ?? 12_000);
    acked = () => {
      clearInterval(knock);
      clearTimeout(timer);
      acked = null;
      resolve();
    };
    up({ k: "o" });
  });
  return link;
}

// ---- hosting a group ------------------------------------------------------------

export interface RelayHost {
  close(): void;
  /** true while connected to the relay */
  online(): boolean;
}

/** Serves the group over the relay. Reconnects on its own if the relay connection drops. */
export async function relayHost(code: string, server: SocialServer, opts: { WS?: WsCtor; brokers?: string[]; onStatus?: (online: boolean) => void } = {}): Promise<RelayHost> {
  const url = brokerOf(code, opts.brokers);
  const { key, topic } = await deriveSecrets(code);
  const seen = new Map<string, number>();
  let mqtt: Mqtt | null = null;
  let stopped = false;
  let retry = 0;
  const down = (c: string, f: Omit<Frame, "c">) => void seal(key, { c, ...f }).then((b) => mqtt?.publish(`${topic}/d/${c}`, b));
  const id = (c: string) => `relay:${c}`;

  const attach = async () => {
    const m = await Mqtt.connect(url, opts.WS);
    m.onMessage = (_t, payload) =>
      void unseal<Frame>(key, payload).then((f) => {
        if (!f || typeof f.c !== "string" || !/^[0-9a-f]{16}$/.test(f.c)) return;
        const known = seen.has(f.c);
        if (f.k === "o") {
          if (!known) server.connect(id(f.c), (text) => down(f.c, { k: "m", d: text }));
          seen.set(f.c, Date.now());
          return down(f.c, { k: "a" });
        }
        if (!known) return down(f.c, { k: "b" });
        seen.set(f.c, Date.now());
        if (f.k === "m" && f.d != null) void server.receive(id(f.c), f.d);
        else if (f.k === "p") down(f.c, { k: "q" });
        else if (f.k === "b") {
          seen.delete(f.c);
          server.disconnect(id(f.c));
        }
      });
    m.onClose = () => {
      opts.onStatus?.(false);
      if (stopped) return;
      setTimeout(() => void attach().catch(() => m.onClose?.()), Math.min(30_000, 2000 * 2 ** retry++));
    };
    await m.subscribe(`${topic}/u`);
    mqtt = m;
    retry = 0;
    opts.onStatus?.(true);
  };
  await attach();

  const gc = setInterval(() => {
    const t = Date.now();
    for (const [c, at] of seen) {
      if (t - at > CLIENT_SILENT_MS) {
        seen.delete(c);
        server.disconnect(id(c));
      }
    }
  }, 15_000);

  return {
    online: () => !!mqtt?.open,
    close: () => {
      stopped = true;
      clearInterval(gc);
      for (const c of seen.keys()) {
        down(c, { k: "b" });
        server.disconnect(id(c));
      }
      seen.clear();
      setTimeout(() => mqtt?.close(), 150);
    },
  };
}

/** Finds the first public relay that answers, for a new group. */
export async function pickBroker(WS?: WsCtor, brokers = BROKERS): Promise<number> {
  for (let i = 0; i < brokers.length; i++) {
    try {
      (await Mqtt.connect(brokers[i]!, WS, 6000)).close();
      return i;
    } catch {
      /* try the next one */
    }
  }
  throw new Error(tr("None of the public relays could be reached. Check your internet connection, or use a server address instead."));
}

/** The host's own app talks to its server directly, without going through the relay. */
export function localLink(server: SocialServer): Link {
  const conn = `local:${Math.random().toString(36).slice(2)}`;
  const link: Link = {
    onmessage: null,
    onclose: null,
    send: (text) => void server.receive(conn, text),
    close: () => {
      server.disconnect(conn);
      link.onclose?.();
    },
  };
  server.connect(conn, (text) => queueMicrotask(() => link.onmessage?.(text)));
  return link;
}
