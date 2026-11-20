import {
  procesarNotificacionesHorarios,
  NotificacionProcesoResultado,
} from "@/lib/pushNotifications";
import {
  procesarCierresAutomaticos,
  CierreAutomaticoResultado,
} from "@/lib/autoCloseActivities";
import { getBogotaNowParts } from "@/lib/horarios";

export interface CicloHorariosResultado {
  ejecutadoEn: string;
  zonaHoraria: string;
  fechaBogota: string;
  horaBogota: string;
  diaBogota: string;
  omitidoPorSolapamiento: boolean;
  notificaciones: NotificacionProcesoResultado | null;
  cierresAutomaticos: CierreAutomaticoResultado | null;
  error?: string;
}

interface SchedulerState {
  started: boolean;
  running: boolean;
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastRunAt: string | null;
  lastResult: CicloHorariosResultado | null;
  lastEvaluatedMinuteEpoch: number | null;
}

const globalForScheduler = globalThis as unknown as {
  __evoHorariosScheduler?: SchedulerState;
};

function getSchedulerState(): SchedulerState {
  if (!globalForScheduler.__evoHorariosScheduler) {
    globalForScheduler.__evoHorariosScheduler = {
      started: false,
      running: false,
      timeoutId: null,
      lastRunAt: null,
      lastResult: null,
      lastEvaluatedMinuteEpoch: null,
    };
  }
  return globalForScheduler.__evoHorariosScheduler;
}

/**
 * Permite habilitar/deshabilitar el envío automático de notificaciones push
 * de forma independiente al cierre automático de actividades.
 */
export function isPushSchedulerEnabled(): boolean {
  const pushFlag = process.env.PUSH_SCHEDULER_ENABLED?.trim().toLowerCase();
  if (pushFlag === "true") return true;
  if (pushFlag === "false") return false;
  return process.env.SCHEDULER_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * Permite habilitar/deshabilitar el cierre automático de actividades
 * de forma independiente a las notificaciones push.
 */
export function isAutoCloseSchedulerEnabled(): boolean {
  const closeFlag = process.env.AUTO_CLOSE_ENABLED?.trim().toLowerCase();
  if (closeFlag === "true") return true;
  if (closeFlag === "false") return false;
  return process.env.SCHEDULER_ENABLED?.trim().toLowerCase() !== "false";
}

/**
 * Calcula los milisegundos hasta el segundo :02 del siguiente minuto calendario
 * sin saltarse ningún minuto incluso si la ejecución previa terminó en :58 o :59.
 */
export function computeNextMinuteTickDelayMs(
  nowMs: number,
  lastEvaluatedMinuteEpoch: number | null
): { delayMs: number; targetMinuteEpoch: number } {
  const currentMinuteEpoch = Math.floor(nowMs / 60_000);
  const nextMinuteEpoch =
    lastEvaluatedMinuteEpoch !== null
      ? Math.max(currentMinuteEpoch + 1, lastEvaluatedMinuteEpoch + 1)
      : currentMinuteEpoch + 1;

  const targetMs = nextMinuteEpoch * 60_000 + 2_000; // segundo :02 del minuto objetivo
  const delayMs = Math.max(1_000, targetMs - nowMs);
  return { delayMs, targetMinuteEpoch: nextMinuteEpoch };
}

/**
 * Ejecuta un ciclo completo de verificación de horarios:
 *  1. Envío de notificaciones push (5 min antes de hora_inicio y hora_fin).
 *  2. Cierre automático de actividades abiertas al llegar hora_fin + apertura de Tipo O.
 *
 * Seguro ante concurrencia: protegido por mutex en memoria + constraints UNIQUE y FOR UPDATE en PostgreSQL.
 */
export async function ejecutarCicloHorarios(options?: {
  referenceDate?: Date;
  onlyEmpleadoIds?: string[];
  skipSheetsSync?: boolean;
  runPush?: boolean;
  runAutoClose?: boolean;
}): Promise<CicloHorariosResultado> {
  const state = getSchedulerState();
  const nowParts = getBogotaNowParts(options?.referenceDate);
  const executedIso = new Date().toISOString();

  const shouldRunPush = options?.runPush ?? true;
  const shouldRunAutoClose = options?.runAutoClose ?? true;

  if (state.running && !options?.referenceDate) {
    return {
      ejecutadoEn: executedIso,
      zonaHoraria: "America/Bogota",
      fechaBogota: nowParts.fecha,
      horaBogota: nowParts.hhmm,
      diaBogota: nowParts.diaLabel,
      omitidoPorSolapamiento: true,
      notificaciones: null,
      cierresAutomaticos: null,
    };
  }

  state.running = true;
  try {
    let notificaciones: NotificacionProcesoResultado | null = null;
    let cierresAutomaticos: CierreAutomaticoResultado | null = null;
    const errors: string[] = [];

    if (shouldRunPush) {
      try {
        notificaciones = await procesarNotificacionesHorarios({
          referenceDate: options?.referenceDate,
          onlyEmpleadoIds: options?.onlyEmpleadoIds,
        });
      } catch (notifErr: any) {
        const msg = notifErr instanceof Error ? notifErr.message : String(notifErr);
        errors.push(`Notificaciones: ${msg}`);
        console.error("[Scheduler] Error en procesarNotificacionesHorarios:", notifErr);
      }
    }

    if (shouldRunAutoClose) {
      try {
        cierresAutomaticos = await procesarCierresAutomaticos({
          referenceDate: options?.referenceDate,
          onlyEmpleadoIds: options?.onlyEmpleadoIds,
          skipSheetsSync: options?.skipSheetsSync,
        });
      } catch (closeErr: any) {
        const msg = closeErr instanceof Error ? closeErr.message : String(closeErr);
        errors.push(`Cierres: ${msg}`);
        console.error("[Scheduler] Error en procesarCierresAutomaticos:", closeErr);
      }
    }

    const result: CicloHorariosResultado = {
      ejecutadoEn: executedIso,
      zonaHoraria: "America/Bogota",
      fechaBogota: nowParts.fecha,
      horaBogota: nowParts.hhmm,
      diaBogota: nowParts.diaLabel,
      omitidoPorSolapamiento: false,
      notificaciones,
      cierresAutomaticos,
      ...(errors.length > 0 ? { error: errors.join(" | ") } : {}),
    };

    if (!options?.referenceDate) {
      state.lastRunAt = executedIso;
      state.lastResult = result;
    }

    if (
      (notificaciones && (notificaciones.enviadas > 0 || notificaciones.errores > 0)) ||
      (cierresAutomaticos && (cierresAutomaticos.ejecutados > 0 || cierresAutomaticos.errores > 0))
    ) {
      console.log(
        `[Scheduler ${nowParts.fecha} ${nowParts.hhmm} COT] Push enviadas=${notificaciones?.enviadas ?? 0}, errPush=${notificaciones?.errores ?? 0}, sinSub=${notificaciones?.sinSuscripcion ?? 0} | Cierres auto=${cierresAutomaticos?.ejecutados ?? 0}, errCierres=${cierresAutomaticos?.errores ?? 0}`
      );
    }

    return result;
  } finally {
    state.running = false;
  }
}

/**
 * Ejecuta exclusivamente el despacho de notificaciones push (5 min antes de inicio y salida).
 */
export async function ejecutarSoloNotificacionesPush(options?: {
  referenceDate?: Date;
  onlyEmpleadoIds?: string[];
}): Promise<CicloHorariosResultado> {
  return ejecutarCicloHorarios({
    referenceDate: options?.referenceDate,
    onlyEmpleadoIds: options?.onlyEmpleadoIds,
    runPush: true,
    runAutoClose: false,
  });
}

/**
 * Inicia el programador de tareas en segundo plano en el proceso Node.js del servidor.
 * Alinea cada ejecución al segundo :02 de cada minuto para capturar con precisión
 * los avisos de 5 minutos antes (y los cierres exactos a hora_fin si están activos)
 * incluso sin navegadores abiertos.
 */
export function iniciarSchedulerHorarios() {
  const pushEnabled = isPushSchedulerEnabled();
  const autoCloseEnabled = isAutoCloseSchedulerEnabled();

  if (!pushEnabled && !autoCloseEnabled) {
    console.log(
      "[Scheduler] Deshabilitado (PUSH_SCHEDULER_ENABLED=false y AUTO_CLOSE_ENABLED=false)."
    );
    return;
  }

  // No iniciar durante la fase de compilación de Next.js
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const state = getSchedulerState();
  if (state.started) return;
  state.started = true;

  const runTick = async () => {
    const tickStartMinute = Math.floor(Date.now() / 60_000);
    state.lastEvaluatedMinuteEpoch = tickStartMinute;
    try {
      await ejecutarCicloHorarios({
        runPush: isPushSchedulerEnabled(),
        runAutoClose: isAutoCloseSchedulerEnabled(),
      });
    } catch (err) {
      console.error("[Scheduler] Error no controlado en ciclo programado:", err);
    }
  };

  const scheduleNextTick = () => {
    const { delayMs } = computeNextMinuteTickDelayMs(
      Date.now(),
      state.lastEvaluatedMinuteEpoch
    );

    state.timeoutId = setTimeout(async () => {
      await runTick();
      scheduleNextTick();
    }, delayMs);

    if (typeof state.timeoutId.unref === "function") {
      state.timeoutId.unref();
    }
  };

  console.log(
    `[Scheduler] Programador de horarios (America/Bogota) iniciado en segundo plano. push=${pushEnabled}, autoClose=${autoCloseEnabled}`
  );

  // Ejecutar una primera pasada 5s después del arranque y luego en cada minuto (:02)
  state.timeoutId = setTimeout(async () => {
    await runTick();
    scheduleNextTick();
  }, 5_000);

  if (typeof state.timeoutId.unref === "function") {
    state.timeoutId.unref();
  }
}

export function getSchedulerStatus() {
  const state = getSchedulerState();
  return {
    started: state.started,
    running: state.running,
    pushSchedulerEnabled: isPushSchedulerEnabled(),
    autoCloseEnabled: isAutoCloseSchedulerEnabled(),
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
  };
}
