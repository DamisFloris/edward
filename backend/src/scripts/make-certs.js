// Genera un certificato self-signed per servire Edward in HTTPS sulla rete di casa.
// Uso: npm run certs --workspace backend [-- nome1 ip1 ...]
import path from "node:path";
import { ROOT_DIR } from "../config.js";
import { makeCerts } from "../services/certs.js";

const { cert, key, san } = makeCerts(path.join(ROOT_DIR, "certs"), process.argv.slice(2));
console.log(`Certificati creati (${san})\nAggiungi al .env:\nHTTPS_CERT=${cert}\nHTTPS_KEY=${key}`);
