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
    };
  }
  return globalForScheduler.__evoHorariosScheduler;
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
}): Promise<CicloHorariosResultado> {
  const state = getSchedulerState();
  const nowParts = getBogotaNowParts(options?.referenceDate);
  const executedIso = new Date().toISOString();

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
        `[Scheduler ${nowParts.fecha} ${nowParts.hhmm} COT] Push enviadas=${notificaciones?.enviadas ?? 0}, errPush=${notificaciones?.errores ?? 0} | Cierres auto=${cierresAutomaticos?.ejecutados ?? 0}, errCierres=${cierresAutomaticos?.errores ?? 0}`
      );
    }

    return result;
  } finally {
    state.running = false;
  }
}

/**
 * Inicia el programador de tareas en segundo plano en el proceso Node.js del servidor.
 * Alinea cada ejecución al segundo :02 de cada minuto para capturar con precisión
 * los avisos de 5 minutos antes y los cierres exactos a hora_fin incluso sin navegadores abiertos.
 */
export function iniciarSchedulerHorarios() {
  if (process.env.SCHEDULER_ENABLED === "false") {
    console.log("[Scheduler] Deshabilitado por variable SCHEDULER_ENABLED=false.");
    return;
  }

  // No iniciar durante la fase de compilación de Next.js
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return;
  }

  const state = getSchedulerState();
  if (state.started) return;
  state.started = true;

  const scheduleNextTick = () => {
    const now = Date.now();
    // Calcular milisegundos hasta el segundo :02 del próximo minuto
    const msIntoMinute = now % 60_000;
    let delay = 62_000 - msIntoMinute;
    if (delay > 60_000) delay -= 60_000;
    if (delay < 5_000) delay += 60_000;

    state.timeoutId = setTimeout(async () => {
      try {
        await ejecutarCicloHorarios();
      } catch (err) {
        console.error("[Scheduler] Error no controlado en ciclo programado:", err);
      } finally {
        scheduleNextTick();
      }
    }, delay);

    if (typeof state.timeoutId.unref === "function") {
      state.timeoutId.unref();
    }
  };

  console.log("[Scheduler] Programador de horarios (America/Bogota) iniciado en segundo plano.");

  // Ejecutar una primera pasada 8s después del arranque y luego cada minuto
  state.timeoutId = setTimeout(async () => {
    try {
      await ejecutarCicloHorarios();
    } catch (err) {
      console.error("[Scheduler] Error en primera pasada al arrancar:", err);
    } finally {
      scheduleNextTick();
    }
  }, 8_000);

  if (typeof state.timeoutId.unref === "function") {
    state.timeoutId.unref();
  }
}

export function getSchedulerStatus() {
  const state = getSchedulerState();
  return {
    started: state.started,
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
  };
}
