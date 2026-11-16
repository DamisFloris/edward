// Certificato self-signed per servire Edward in HTTPS sulla rete di casa
// (i browser concedono il microfono solo su https:// o su localhost).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const isIp = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h);

/** Crea cert.pem e key.pem in `dir`. `extraHosts`: nomi o IP con cui raggiungerai Edward (es. raspberrypi.local). */
export function makeCerts(dir, extraHosts = []) {
  fs.mkdirSync(dir, { recursive: true });
  const host = os.hostname();
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
  const names = new Set(["localhost", host, host.endsWith(".local") ? host : `${host}.local`, ...extraHosts.filter((h) => !isIp(h))]);
  const addrs = new Set(["127.0.0.1", ...ips, ...extraHosts.filter(isIp)]);
  const san = [...[...names].map((n) => `DNS:${n}`), ...[...addrs].map((ip) => `IP:${ip}`)].join(",");
  const cn = extraHosts.find((h) => !isIp(h)) || host;
  const cert = path.join(dir, "cert.pem");
  const key = path.join(dir, "key.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "3650", "-keyout", key, "-out", cert, "-subj", `/CN=${cn}`, "-addext", `subjectAltName=${san}`],
    { stdio: "ignore" },
  );
  return { cert, key, san };
}

/**
 * Restituisce cert/key in `dir`, creandoli (o rigenerandoli) se mancano
 * o se non coprono tutti gli `hosts` richiesti (es. dopo aver cambiato PUBLIC_URL o CERT_HOSTS).
 */
export function ensureCerts(dir, hosts = []) {
  const cert = path.join(dir, "cert.pem");
  const key = path.join(dir, "key.pem");
  const meta = path.join(dir, "hosts.json");
  let covered = [];
  try {
    covered = JSON.parse(fs.readFileSync(meta, "utf8"));
  } catch {}
  const ok = fs.existsSync(cert) && fs.existsSync(key) && hosts.every((h) => covered.includes(h));
  if (ok) return { cert, key, created: false };
  const files = makeCerts(dir, hosts);
  fs.writeFileSync(meta, JSON.stringify(hosts));
  return { ...files, created: true };
}
