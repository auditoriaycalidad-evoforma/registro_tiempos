import fs from "fs";
import path from "path";

// Cargar .env local si no está en el entorno
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

import prisma from "../src/lib/prisma";
import { procesarNotificacionesHorarios } from "../src/lib/pushNotifications";
import { computeNextMinuteTickDelayMs } from "../src/lib/scheduler";

const runOnce = process.argv.includes("--once");

async function executeCycle() {
  const result = await procesarNotificacionesHorarios();
  console.log(
    `[PushWorker ${result.fecha} ${result.horaBogota} COT (${result.dia})] evaluados=${result.evaluados} enviadas=${result.enviadas} sinSub=${result.sinSuscripcion} errores=${result.errores} duplicadas=${result.omitidasDuplicadas}`
  );
  if (result.errores > 0) {
    for (const d of result.detalles.filter((x) => x.estado === "ERROR")) {
      console.error(
        `  [ERROR] empleado=${d.empleadoId} tipo=${d.tipoEvento} prog=${d.horaProgramada} -> ${d.error}`
      );
    }
  }
  return result;
}

async function main() {
  if (runOnce) {
    try {
      await executeCycle();
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  console.log(
    "[PushWorker] Worker dedicado de notificaciones push (America/Bogota) iniciado. Evaluando cada minuto en :02..."
  );

  let lastEvaluatedMinuteEpoch: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopping = false;

  const tick = async () => {
    if (stopping) return;
    lastEvaluatedMinuteEpoch = Math.floor(Date.now() / 60_000);
    try {
      await executeCycle();
    } catch (err) {
      console.error("[PushWorker] Error en ciclo:", err);
    }

    if (stopping) return;
    const { delayMs } = computeNextMinuteTickDelayMs(
      Date.now(),
      lastEvaluatedMinuteEpoch
    );
    timer = setTimeout(tick, delayMs);
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[PushWorker] Recibida señal ${signal}, cerrando...`);
    if (timer) clearTimeout(timer);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await tick();
}

main().catch(async (err) => {
  console.error("[PushWorker] Error fatal:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
