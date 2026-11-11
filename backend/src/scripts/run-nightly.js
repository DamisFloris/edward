// Esegue a mano la pipeline notturna: `npm run nightly`
import { runNightly } from "../services/briefing.js";

try {
  const b = await runNightly();
  console.log("\n===== GIORNALE =====\n");
  console.log(b.spokenScript);
  process.exit(0);
} catch (e) {
  console.error(e);
  process.exit(1);
}
