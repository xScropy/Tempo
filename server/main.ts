/**
 * Standalone Tempo social server.
 *
 * Run it anywhere friends can reach: a home machine on the LAN, or a small
 * cloud instance behind TLS for friends on other networks. It keeps no
 * productivity data beyond what users chose to share — anonymous time
 * intervals, profiles, friendships, challenges and rooms — in one JSON file.
 *
 *   PORT       port to listen on (default 47800)
 *   DATA_DIR   where state.json lives (default ./data)
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { SocialServer, emptyState, type ServerState } from "../src/social/server";

const port = Number(process.env.PORT) || 47800;
const dir = process.env.DATA_DIR || "./data";
const file = join(dir, "state.json");
mkdirSync(dir, { recursive: true });

let state: ServerState = emptyState();
try {
  state = { ...state, ...JSON.parse(readFileSync(file, "utf8")) };
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
    console.error(`Could not read ${file}; refusing to start so existing data is not overwritten.`, e);
    process.exit(1);
  }
}

let saveTimer: NodeJS.Timeout | null = null;
function save() {
  saveTimer = null;
  // write-then-rename so a crash mid-write can never leave a truncated file
  writeFileSync(`${file}.tmp`, JSON.stringify(server.state));
  renameSync(`${file}.tmp`, file);
}
const server = new SocialServer(state, { onChange: () => (saveTimer ??= setTimeout(save, 1000)) });

const http = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, users: Object.keys(server.state.users).length }));
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Tempo social server. Connect from Tempo → Social using this address with ws:// or wss://.\n");
});

const wss = new WebSocketServer({ server: http, maxPayload: 1 << 20 });
let next = 0;
wss.on("connection", (socket) => {
  const id = `c${++next}`;
  server.connect(id, (text) => socket.readyState === socket.OPEN && socket.send(text));
  socket.on("message", (raw) => void server.receive(id, raw.toString()));
  socket.on("close", () => server.disconnect(id));
  socket.on("error", () => socket.close());
});

setInterval(() => server.tick(), 5000);
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (saveTimer) save();
    process.exit(0);
  });
}
http.listen(port, () => console.log(`Tempo social server listening on port ${port} (data in ${dir})`));
