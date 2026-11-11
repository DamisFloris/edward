import express from "express";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { config, FRONTEND_DIST, DATA_DIR } from "./config.js";
import { makeCerts } from "./services/certs.js";
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
  const dir = path.join(DATA_DIR, "certs");
  let files = { cert: path.join(dir, "cert.pem"), key: path.join(dir, "key.pem") };
  if (!fs.existsSync(files.cert) || !fs.existsSync(files.key)) {
    files = makeCerts(dir, config.certHosts);
    console.log(`Certificato HTTPS creato (${files.san})`);
  }
  config.httpsCert = files.cert;
  config.httpsKey = files.key;
}

const useHttps = config.httpsCert && config.httpsKey;
const server = useHttps
  ? https.createServer({ cert: fs.readFileSync(config.httpsCert), key: fs.readFileSync(config.httpsKey) }, app)
  : http.createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`Edward è sveglio su ${useHttps ? "https" : "http"}://${config.host}:${config.port}`);
  if (!config.anthropicConfigured) console.warn("⚠ ANTHROPIC_API_KEY mancante: l'assistente AI è disattivato.");
});

scheduleNightly();
