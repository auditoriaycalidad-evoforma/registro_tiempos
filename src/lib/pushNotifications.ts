import prisma from "@/lib/prisma";
import {
  bogotaDateAndTimeToTimestamp,
  getBogotaNowParts,
  getHorariosActivosParaDia,
  HorarioEmpleadoActivo,
  HorarioInconsistencia,
  minutesToTimeString,
  toPrismaDate,
  toPrismaTime,
} from "@/lib/horarios";

export type TipoEventoNotificacion = "INICIO_JORNADA" | "FIN_JORNADA";

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  tipoEvento: TipoEventoNotificacion | "PRUEBA";
  empleadoId: string;
  fecha: string;
  horaObjetivo: string;
}

export interface NotificacionProcesoResultado {
  fecha: string;
  horaBogota: string;
  dia: string;
  vapidConfigurado: boolean;
  evaluados: number;
  enviadas: number;
  sinSuscripcion: number;
  errores: number;
  omitidasDuplicadas: number;
  inconsistencias: HorarioInconsistencia[];
  detalles: Array<{
    empleadoId: string;
    tipoEvento: TipoEventoNotificacion;
    horaProgramada: string;
    fechaHoraProgramada: string;
    claveIdempotencia: string;
    estado: string;
    mensaje: string;
    error?: string;
  }>;
}

export type PushSenderFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string
) => Promise<void>;

type WebPushModule = typeof import("web-push");

let webPushModulePromise: Promise<WebPushModule> | null = null;
let lastVapidSignature = "";

/**
 * Carga dinámica compatible con Node 20+ (web-push v4 es ESM puro).
 * Evita ERR_REQUIRE_ESM en contenedores Node 20 cuando Next.js externaliza web-push.
 */
export async function loadWebPushModule(): Promise<WebPushModule> {
  if (!webPushModulePromise) {
    webPushModulePromise = import("web-push");
  }
  return webPushModulePromise;
}

export function getVapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject =
    process.env.VAPID_SUBJECT?.trim() || "mailto:auditoriaycalidad@evoforma.net";

  return {
    publicKey,
    privateKey,
    subject,
    configured: Boolean(publicKey && privateKey && subject),
  };
}

export async function ensureVapidConfigured(): Promise<boolean> {
  const cfg = getVapidConfig();
  if (!cfg.configured) return false;

  const signature = `${cfg.subject}|${cfg.publicKey}|${cfg.privateKey}`;
  if (signature !== lastVapidSignature) {
    const webpush = await loadWebPushModule();
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    lastVapidSignature = signature;
  }
  return true;
}

export function buildIdempotencyKey(
  empleadoId: string,
  fecha: string,
  tipoEvento: TipoEventoNotificacion,
  horaProgramadaHHMM: string
): string {
  return `${empleadoId.trim()}|${fecha}|${tipoEvento}|${horaProgramadaHHMM}`;
}

export function buildNotificationMessage(
  tipoEvento: TipoEventoNotificacion,
  nombreSaludo: string
): { title: string; body: string } {
  if (tipoEvento === "INICIO_JORNADA") {
    return {
      title: "Inicio de jornada en 5 minutos",
      body: `Hola ${nombreSaludo}, en 5 minutos inicia tu jornada. Recuerda registrar tu actividad`,
    };
  }

  return {
    title: "Cierre de jornada en 5 minutos",
    body: `Hola ${nombreSaludo}, tu horario habitual finaliza en 5 minutos. Recuerda registrar el cierre de tu actividad`,
  };
}

/**
 * Determina si la hora actual (en minutos de America/Bogota) está dentro de la ventana
 * de envío de 5 minutos antes de un objetivo (con tolerancia de 0 a 2 minutos por reinicios/latencia,
 * siempre estrictamente antes de la hora objetivo).
 */
export function isWithinFiveMinuteNoticeWindow(
  currentMinutes: number,
  targetEventMinutes: number,
  toleranceMinutes = 2
): { match: boolean; scheduledMinutes: number } {
  const scheduledMinutes = targetEventMinutes - 5;
  if (scheduledMinutes < 0) {
    return { match: false, scheduledMinutes };
  }
  const maxAllowed = Math.min(targetEventMinutes - 1, scheduledMinutes + toleranceMinutes);
  const match = currentMinutes >= scheduledMinutes && currentMinutes <= maxAllowed;
  return { match, scheduledMinutes };
}

async function enviarEventoIndividual(
  horario: HorarioEmpleadoActivo,
  fecha: string,
  tipoEvento: TipoEventoNotificacion,
  horaProgramadaHHMM: string,
  horaObjetivoHHMM: string,
  vapidConfigurado: boolean,
  sender: PushSenderFn
): Promise<{
  status: "ENVIADA" | "SIN_SUSCRIPCION" | "ERROR" | "DUPLICADA";
  mensaje: string;
  fechaHoraProgramadaIso: string;
  claveIdempotencia: string;
  error?: string;
}> {
  const { title, body } = buildNotificationMessage(tipoEvento, horario.nombreSaludo);
  const fechaDate = toPrismaDate(fecha);
  const horaProgramadaDate = toPrismaTime(horaProgramadaHHMM);
  const fechaHoraProgramadaDate = new Date(
    bogotaDateAndTimeToTimestamp(fecha, horaProgramadaHHMM)
  );
  const fechaHoraProgramadaIso = fechaHoraProgramadaDate.toISOString();
  const claveIdempotencia = buildIdempotencyKey(
    horario.empleadoId,
    fecha,
    tipoEvento,
    horaProgramadaHHMM
  );

  // Reserva atómica de idempotencia mediante UNIQUE(empleado_id, fecha, tipo_evento, hora_programada)
  // Garantiza cero duplicados incluso ante reintentos o ejecuciones concurrentes entre procesos/contenedores.
  let logRecordId: number;
  try {
    const created = await prisma.minuta_notificacion_log.create({
      data: {
        empleado_id: horario.empleadoId,
        fecha: fechaDate,
        tipo_evento: tipoEvento,
        hora_programada: horaProgramadaDate,
        fecha_hora_programada: fechaHoraProgramadaDate,
        clave_idempotencia: claveIdempotencia,
        mensaje: body,
        estado: "PROCESANDO",
        suscripciones_intentadas: 0,
        suscripciones_exitosas: 0,
        ejecutado_en: new Date(),
      },
      select: { id: true },
    });
    logRecordId = created.id;
  } catch (err: any) {
    if (err?.code === "P2002") {
      return {
        status: "DUPLICADA",
        mensaje: body,
        fechaHoraProgramadaIso,
        claveIdempotencia,
      };
    }
    throw err;
  }

  try {
    if (!vapidConfigurado) {
      const vapidErr =
        "Claves VAPID no configuradas en el servidor (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).";
      await prisma.minuta_notificacion_log.update({
        where: { id: logRecordId },
        data: {
          estado: "ERROR",
          suscripciones_intentadas: 0,
          suscripciones_exitosas: 0,
          error_detalle: vapidErr,
          ejecutado_en: new Date(),
        },
      });
      return {
        status: "ERROR",
        mensaje: body,
        fechaHoraProgramadaIso,
        claveIdempotencia,
        error: vapidErr,
      };
    }

    // Revalidar estrictamente que el empleado siga con activo = 'SI' por su documento
    const emp = await prisma.minuta_empleado.findUnique({
      where: { id: horario.empleadoId },
      select: { activo: true },
    });

    if (!emp || String(emp.activo ?? "").trim().toUpperCase() !== "SI") {
      await prisma.minuta_notificacion_log.update({
        where: { id: logRecordId },
        data: {
          estado: "OMITIDA",
          error_detalle: "Empleado inactivo al momento del envío.",
          ejecutado_en: new Date(),
        },
      });
      return {
        status: "DUPLICADA",
        mensaje: body,
        fechaHoraProgramadaIso,
        claveIdempotencia,
      };
    }

    const suscripciones = await prisma.minuta_push_suscripcion.findMany({
      where: {
        empleado_id: horario.empleadoId,
        activa: true,
      },
    });

    if (suscripciones.length === 0) {
      await prisma.minuta_notificacion_log.update({
        where: { id: logRecordId },
        data: {
          estado: "SIN_SUSCRIPCION",
          suscripciones_intentadas: 0,
          suscripciones_exitosas: 0,
          error_detalle: "El empleado no tiene suscripciones Web Push activas.",
          ejecutado_en: new Date(),
        },
      });
      return {
        status: "SIN_SUSCRIPCION",
        mensaje: body,
        fechaHoraProgramadaIso,
        claveIdempotencia,
      };
    }

    const payload: PushPayload = {
      title,
      body,
      tag: `evo-${tipoEvento.toLowerCase()}-${horario.empleadoId}-${fecha}-${horaProgramadaHHMM.replace(":", "")}`,
      url: "/pwa",
      tipoEvento,
      empleadoId: horario.empleadoId,
      fecha,
      horaObjetivo: horaObjetivoHHMM,
    };
    const serializedPayload = JSON.stringify(payload);

    let exitosas = 0;
    const erroresEnvio: string[] = [];

    for (const sub of suscripciones) {
      try {
        await sender(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          serializedPayload
        );
        exitosas++;
      } catch (pushErr: any) {
        const statusCode = pushErr?.statusCode ?? pushErr?.status;
        const errMsg = pushErr?.body || pushErr?.message || String(pushErr);
        erroresEnvio.push(`[sub#${sub.id} HTTP ${statusCode ?? "ERR"}] ${errMsg}`);

        // Si el navegador revocó o expiró la suscripción (404/410), desactivarla automáticamente
        if (statusCode === 404 || statusCode === 410) {
          await prisma.minuta_push_suscripcion
            .update({
              where: { id: sub.id },
              data: {
                activa: false,
                last_error: `HTTP ${statusCode}: ${String(errMsg).slice(0, 400)}`,
                updated_at: new Date(),
              },
            })
            .catch(() => {});
        } else {
          await prisma.minuta_push_suscripcion
            .update({
              where: { id: sub.id },
              data: {
                last_error: `HTTP ${statusCode ?? "ERR"}: ${String(errMsg).slice(0, 400)}`,
                updated_at: new Date(),
              },
            })
            .catch(() => {});
        }
      }
    }

    const estadoFinal = exitosas > 0 ? "ENVIADA" : "ERROR";
    const errorDetalle =
      erroresEnvio.length > 0 ? erroresEnvio.join(" | ").slice(0, 2000) : null;

    await prisma.minuta_notificacion_log.update({
      where: { id: logRecordId },
      data: {
        estado: estadoFinal,
        suscripciones_intentadas: suscripciones.length,
        suscripciones_exitosas: exitosas,
        error_detalle: errorDetalle,
        ejecutado_en: new Date(),
      },
    });

    return {
      status: estadoFinal,
      mensaje: body,
      fechaHoraProgramadaIso,
      claveIdempotencia,
      error: errorDetalle || undefined,
    };
  } catch (fatalErr: any) {
    const errText = fatalErr instanceof Error ? fatalErr.message : String(fatalErr);
    await prisma.minuta_notificacion_log
      .update({
        where: { id: logRecordId },
        data: {
          estado: "ERROR",
          error_detalle: errText.slice(0, 2000),
          ejecutado_en: new Date(),
        },
      })
      .catch(() => {});

    return {
      status: "ERROR",
      mensaje: body,
      fechaHoraProgramadaIso,
      claveIdempotencia,
      error: errText,
    };
  }
}

/**
 * Evalúa y envía las notificaciones push programadas (5 minutos antes de hora_inicio y hora_fin)
 * para todos los empleados activos (activo = 'SI') en zona horaria America/Bogota.
 */
export async function procesarNotificacionesHorarios(options?: {
  referenceDate?: Date;
  customSender?: PushSenderFn;
  onlyEmpleadoIds?: string[];
  forceVapidUnconfigured?: boolean;
}): Promise<NotificacionProcesoResultado> {
  const nowParts = getBogotaNowParts(options?.referenceDate);
  const vapidConfigurado = options?.forceVapidUnconfigured
    ? false
    : options?.customSender
      ? true
      : await ensureVapidConfigured();

  const sender: PushSenderFn =
    options?.customSender ||
    (async (subscription, payload) => {
      const webpush = await loadWebPushModule();
      await webpush.sendNotification(subscription, payload, {
        TTL: 60 * 15, // 15 minutos
        urgency: "high",
      });
    });

  const { horarios, inconsistencias } = await getHorariosActivosParaDia(nowParts.diaNormalizado);

  const filteredHorarios = options?.onlyEmpleadoIds?.length
    ? horarios.filter((h) => options.onlyEmpleadoIds!.includes(h.empleadoId))
    : horarios;

  const result: NotificacionProcesoResultado = {
    fecha: nowParts.fecha,
    horaBogota: nowParts.hhmm,
    dia: nowParts.diaLabel,
    vapidConfigurado,
    evaluados: filteredHorarios.length,
    enviadas: 0,
    sinSuscripcion: 0,
    errores: 0,
    omitidasDuplicadas: 0,
    inconsistencias,
    detalles: [],
  };

  if (!vapidConfigurado) {
    console.warn(
      "[PushNotifications] Claves VAPID no configuradas (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)."
    );
  }

  for (const horario of filteredHorarios) {
    const eventosAChequear: Array<{
      tipo: TipoEventoNotificacion;
      objetivoMinutos: number;
      objetivoHHMM: string;
    }> = [
      {
        tipo: "INICIO_JORNADA",
        objetivoMinutos: horario.horaInicioMinutos,
        objetivoHHMM: horario.horaInicio,
      },
      {
        tipo: "FIN_JORNADA",
        objetivoMinutos: horario.horaFinMinutos,
        objetivoHHMM: horario.horaFin,
      },
    ];

    for (const ev of eventosAChequear) {
      const check = isWithinFiveMinuteNoticeWindow(nowParts.totalMinutes, ev.objetivoMinutos);
      if (!check.match) continue;

      const horaProgramadaHHMM = minutesToTimeString(check.scheduledMinutes);
      const outcome = await enviarEventoIndividual(
        horario,
        nowParts.fecha,
        ev.tipo,
        horaProgramadaHHMM,
        ev.objetivoHHMM,
        vapidConfigurado,
        sender
      );

      if (outcome.status === "ENVIADA") result.enviadas++;
      else if (outcome.status === "SIN_SUSCRIPCION") result.sinSuscripcion++;
      else if (outcome.status === "ERROR") result.errores++;
      else if (outcome.status === "DUPLICADA") result.omitidasDuplicadas++;

      result.detalles.push({
        empleadoId: horario.empleadoId,
        tipoEvento: ev.tipo,
        horaProgramada: horaProgramadaHHMM,
        fechaHoraProgramada: outcome.fechaHoraProgramadaIso,
        claveIdempotencia: outcome.claveIdempotencia,
        estado: outcome.status,
        mensaje: outcome.mensaje,
        error: outcome.error,
      });
    }
  }

  return result;
}

/**
 * Envía una notificación Web Push de prueba inmediata a las suscripciones activas
 * de un empleado específico (útil para verificar entrega con navegador cerrado).
 */
export async function enviarNotificacionPruebaUsuario(
  empleadoId: string,
  customSender?: PushSenderFn
): Promise<{
  ok: boolean;
  intentadas: number;
  exitosas: number;
  errores: string[];
}> {
  const vapidOk = customSender ? true : await ensureVapidConfigured();
  if (!vapidOk) {
    return {
      ok: false,
      intentadas: 0,
      exitosas: 0,
      errores: ["Claves VAPID no configuradas en el servidor."],
    };
  }

  const suscripciones = await prisma.minuta_push_suscripcion.findMany({
    where: { empleado_id: empleadoId.trim(), activa: true },
  });

  if (suscripciones.length === 0) {
    return {
      ok: false,
      intentadas: 0,
      exitosas: 0,
      errores: ["No tienes dispositivos suscritos a notificaciones push."],
    };
  }

  const nowParts = getBogotaNowParts();
  const sender: PushSenderFn =
    customSender ||
    (async (subscription, payload) => {
      const webpush = await loadWebPushModule();
      await webpush.sendNotification(subscription, payload, {
        TTL: 60 * 5,
        urgency: "high",
      });
    });

  const payload: PushPayload = {
    title: "Evoforma - Prueba de notificación push",
    body: `Notificación de prueba enviada desde el backend (${nowParts.fecha} ${nowParts.hhmm} COT). Tus avisos de jornada están activos.`,
    tag: `evo-test-${empleadoId}-${Date.now()}`,
    url: "/pwa",
    tipoEvento: "PRUEBA",
    empleadoId,
    fecha: nowParts.fecha,
    horaObjetivo: nowParts.hhmm,
  };
  const serialized = JSON.stringify(payload);

  let exitosas = 0;
  const errores: string[] = [];

  for (const sub of suscripciones) {
    try {
      await sender(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        serialized
      );
      exitosas++;
    } catch (pushErr: any) {
      const statusCode = pushErr?.statusCode ?? pushErr?.status;
      const errMsg = pushErr?.body || pushErr?.message || String(pushErr);
      errores.push(`[sub#${sub.id} HTTP ${statusCode ?? "ERR"}] ${errMsg}`);
      if (statusCode === 404 || statusCode === 410) {
        await prisma.minuta_push_suscripcion
          .update({
            where: { id: sub.id },
            data: {
              activa: false,
              last_error: `HTTP ${statusCode}: ${String(errMsg).slice(0, 400)}`,
              updated_at: new Date(),
            },
          })
          .catch(() => {});
      }
    }
  }

  return {
    ok: exitosas > 0,
    intentadas: suscripciones.length,
    exitosas,
    errores,
  };
}
