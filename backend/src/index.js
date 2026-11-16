import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { config, FRONTEND_DIST, DATA_DIR } from "./config.js";
import { ensureCerts } from "./services/certs.js";
import "./db.js";
import { api } from "./routes/api.js";
import { scheduleNightly } from "./jobs/nightly.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/api", api);

// In produzione il backend serve anche il frontend compilato (un solo processo sul Raspberry).
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, "index.html")));
}

if (config.httpsAuto && !(config.httpsCert && config.httpsKey)) {
  // Il certificato copre CERT_HOSTS e l'host di PUBLIC_URL (es. 192.168.1.81); si rigenera se cambiano.
  const hosts = [...config.certHosts];
  try {
    if (config.publicUrl) hosts.push(new URL(config.publicUrl).hostname);
  } catch {}
  const files = ensureCerts(path.join(DATA_DIR, "certs"), [...new Set(hosts)]);
  if (files.created) console.log(`Certificato HTTPS creato (${files.san})`);
  config.httpsCert = files.cert;
  config.httpsKey = files.key;
}

const useHttps = Boolean(config.httpsCert && config.httpsKey);
let server;
if (useHttps) {
  const secure = https.createServer({ cert: fs.readFileSync(config.httpsCert), key: fs.readFileSync(config.httpsKey) }, app);
  // Sulla stessa porta: chi arriva in http:// viene rimandato a https://.
  // Da localhost (es. il proxy di Vite in sviluppo) rispondiamo direttamente: è già un contesto sicuro.
  const plain = http.createServer((req, res) => {
    const host = req.headers.host || "";
    const hostname = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return app(req, res);
    res.writeHead(301, { Location: `https://${host}${req.url}` }).end();
  });
  server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.once("data", (buf) => {
      socket.pause();
      socket.unshift(buf);
      // 0x16 = inizio di un handshake TLS
      (buf[0] === 0x16 ? secure : plain).emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });
} else {
  server = http.createServer(app);
}

server.listen(config.port, config.host, () => {
  console.log(`Edward è sveglio su ${useHttps ? "https" : "http"}://${config.host}:${config.port}`);
  if (!config.anthropicConfigured) console.warn("⚠ ANTHROPIC_API_KEY mancante: l'assistente AI è disattivato.");
});

scheduleNightly();
