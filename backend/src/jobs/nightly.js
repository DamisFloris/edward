import cron from "node-cron";
import { config } from "../config.js";
import { runNightly } from "../services/briefing.js";

export function scheduleNightly() {
  if (!cron.validate(config.nightlyCron)) {
    console.error(`[nightly] espressione cron non valida: "${config.nightlyCron}"`);
    return;
  }
  cron.schedule(
    config.nightlyCron,
    () => {
      runNightly().catch((e) => console.error("[nightly] fallito:", e.message));
    },
    { timezone: config.timezone, name: "edward-nightly" },
  );
  console.log(`[nightly] programmato "${config.nightlyCron}" (${config.timezone})`);
}
