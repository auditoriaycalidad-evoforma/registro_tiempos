import prisma from "@/lib/prisma";
import { formatTime24 } from "@/lib/formatTime";
import { sheetsSyncQueue } from "@/lib/syncQueue";
import {
  bogotaDateAndTimeToTimestamp,
  getBogotaNowParts,
  getHorariosActivosParaDia,
  HorarioEmpleadoActivo,
  HorarioInconsistencia,
  isEmpleadoActivo,
  timeStringToMinutes,
  toPrismaDate,
  toPrismaTime,
} from "@/lib/horarios";

export interface CierreAutomaticoDetalle {
  empleadoId: string;
  horaFinProgramada: string;
  estado:
    | "EJECUTADO"
    | "OMITIDO_YA_PROCESADO"
    | "OMITIDO_SIN_ACTIVIDAD"
    | "OMITIDO_FECHA_DISTINTA"
    | "OMITIDO_YA_AUTOGENERADA"
    | "OMITIDO_INICIO_POSTERIOR"
    | "OMITIDO_INACTIVO"
    | "ERROR_SOLAPAMIENTO"
    | "ERROR";
  registroCerradoId?: number;
  tipoOriginal?: string;
  detalle: string;
}

export interface CierreAutomaticoResultado {
  fecha: string;
  horaBogota: string;
  dia: string;
  evaluados: number;
  ejecutados: number;
  omitidos: number;
  errores: number;
  inconsistencias: HorarioInconsistencia[];
  detalles: CierreAutomaticoDetalle[];
}

function buildFormattedObservation(
  rawObservacion: string | null | undefined,
  ubicacion: string | null | undefined
): string {
  let obs = rawObservacion ? rawObservacion.trim() : "";
  const ubi = ubicacion ? ubicacion.trim() : "";
  if (ubi && !obs.includes(ubi)) {
    obs = obs ? `${obs} [📍 ${ubi}]` : `[📍 ${ubi}]`;
  }
  return obs;
}

/**
 * Ejecuta el cierre automático transaccional e idempotente para un empleado activo
 * que alcanzó su hora_fin y tiene una actividad abierta hoy en minuta_actividad_activa.
 *
 * Pasos dentro de una única transacción PostgreSQL con bloqueo de fila (FOR UPDATE):
 *  1. Verifica nuevamente empleado activo = 'SI' y la actividad activa bloqueada.
 *  2. Verifica idempotencia en minuta_cierre_automatico_log (empleado_id, fecha, hora_fin_programada).
 *  3. Cierra la actividad original en minuta_registro_actividad exactamente a hora_fin,
 *     conservando su tipo_minuta original (P u O) y marcando cierre_automatico = true.
 *  4. Crea inmediatamente la nueva actividad abierta Tipo O desde esa misma hora_fin
 *     en minuta_actividad_activa con generado_automaticamente = true y registro_origen_id = closed.id.
 *  5. Registra el log idempotente y la trazabilidad en minuta_auditoria.
 */
async function ejecutarCierreTransaccional(
  horario: HorarioEmpleadoActivo,
  todayBogota: string
): Promise<CierreAutomaticoDetalle> {
  const fechaDate = toPrismaDate(todayBogota);
  const horaFinDate = toPrismaTime(horario.horaFin);

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Verificar idempotencia antes de tocar nada
      const existingLog = await tx.minuta_cierre_automatico_log.findUnique({
        where: {
          empleado_id_fecha_hora_fin_programada: {
            empleado_id: horario.empleadoId,
            fecha: fechaDate,
            hora_fin_programada: horaFinDate,
          },
        },
      });

      if (existingLog) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_YA_PROCESADO",
          registroCerradoId: existingLog.registro_cerrado_id ?? undefined,
          tipoOriginal: existingLog.tipo_original,
          detalle: `Ya existía un cierre automático registrado (estado: ${existingLog.estado}).`,
        };
      }

      // 2. Revalidar empleado estrictamente por documento y activo = 'SI'
      const emp = await tx.minuta_empleado.findUnique({
        where: { id: horario.empleadoId },
        select: { id: true, activo: true, cargo: true },
      });

      if (!emp || !isEmpleadoActivo(emp.activo)) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_INACTIVO",
          detalle: `Empleado ${horario.empleadoId} no está activo (activo='${emp?.activo ?? "NULL"}').`,
        };
      }

      // 3. Bloquear la fila de actividad activa para evitar condiciones de carrera (FOR UPDATE)
      const lockedRows = await tx.$queryRaw<
        Array<{
          empleado_id: string;
          proyecto: string;
          actividad: string;
          hora_inicio: string;
          start_timestamp: bigint;
          observacion: string | null;
          fecha: string;
          tipo_minuta: string;
          ubicacion: string | null;
          generado_automaticamente: boolean;
          registro_origen_id: number | null;
        }>
      >`
        SELECT
          empleado_id,
          proyecto,
          actividad,
          hora_inicio,
          start_timestamp,
          observacion,
          fecha,
          tipo_minuta,
          ubicacion,
          generado_automaticamente,
          registro_origen_id
        FROM public.minuta_actividad_activa
        WHERE empleado_id = ${horario.empleadoId}
        FOR UPDATE
      `;

      const active = lockedRows[0];
      if (!active) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_SIN_ACTIVIDAD",
          detalle: "El empleado no tiene actividad abierta.",
        };
      }

      // Nunca alterar actividades de fechas históricas (solo el día en curso en America/Bogota)
      if (active.fecha !== todayBogota) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_FECHA_DISTINTA",
          detalle: `Actividad abierta pertenece a fecha ${active.fecha} (hoy es ${todayBogota}); no se modifican fechas históricas.`,
        };
      }

      // No volver a partir una actividad ya generada automáticamente
      if (active.generado_automaticamente) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_YA_AUTOGENERADA",
          detalle: "La actividad abierta actual ya fue generada automáticamente.",
        };
      }

      const activeStartMin = timeStringToMinutes(active.hora_inicio);
      if (activeStartMin < 0 || activeStartMin >= horario.horaFinMinutos) {
        return {
          empleadoId: horario.empleadoId,
          horaFinProgramada: horario.horaFin,
          estado: "OMITIDO_INICIO_POSTERIOR",
          detalle: `La actividad inició a las ${active.hora_inicio} (>= hora_fin ${horario.horaFin}); no requiere cierre automático.`,
        };
      }

      // 4. Verificar solapamiento con registros ya guardados ese mismo día
      const existingRecords = await tx.minuta_registro_actividad.findMany({
        where: {
          empleado: horario.empleadoId,
          fecha: fechaDate,
        },
        select: {
          id: true,
          hora_inicio: true,
          hora_fin: true,
        },
      });

      let effectiveStartHHMM = active.hora_inicio.trim().slice(0, 5);
      let effectiveStartMin = activeStartMin;

      for (const rec of existingRecords) {
        const recStartStr = formatTime24(rec.hora_inicio);
        const recEndStr = formatTime24(rec.hora_fin);
        const recStartMin = timeStringToMinutes(recStartStr);
        const recEndMin = timeStringToMinutes(recEndStr);

        if (effectiveStartMin < recEndMin && recStartMin < horario.horaFinMinutos) {
          // Si un registro previo terminó justo después del inicio reportado pero antes de hora_fin, ajustar inicio solo si no hay otro conflicto; si solapa por completo, registrar error controlado
          await tx.minuta_cierre_automatico_log.create({
            data: {
              empleado_id: horario.empleadoId,
              fecha: fechaDate,
              hora_fin_programada: horaFinDate,
              tipo_original: active.tipo_minuta === "O" ? "O" : "P",
              estado: "ERROR_SOLAPAMIENTO",
              detalle: `Solapamiento detectado entre actividad abierta (${effectiveStartHHMM}-${horario.horaFin}) y registro #${rec.id} (${recStartStr}-${recEndStr}).`,
            },
          });

          return {
            empleadoId: horario.empleadoId,
            horaFinProgramada: horario.horaFin,
            estado: "ERROR_SOLAPAMIENTO",
            detalle: `Solapamiento con registro #${rec.id} (${recStartStr}-${recEndStr}).`,
          };
        }
      }

      // 5. Asegurar existencia de proyecto en catálogo minuta_proyecto (para cumplir FK)
      const proyectoExistente = await tx.minuta_proyecto.findUnique({
        where: { code: active.proyecto },
        select: { code: true },
      });

      if (!proyectoExistente) {
        const proyectoRaw = await tx.$queryRaw<{ nombre: string }[]>`
          SELECT COALESCE(nombre_proyecto, cedula) AS nombre
          FROM briefing_2026
          WHERE cedula = ${active.proyecto}
          LIMIT 1
        `;
        await tx.minuta_proyecto.create({
          data: {
            code: active.proyecto,
            nombre: proyectoRaw[0]?.nombre || active.proyecto,
          },
        });
      }

      // 6. Conservar tipo original (P u O) y cerrar exactamente a hora_fin
      const originalTipo = active.tipo_minuta === "O" ? "O" : "P";
      const formattedObs = buildFormattedObservation(active.observacion, active.ubicacion);

      const closedRecord = await tx.minuta_registro_actividad.create({
        data: {
          empleado: horario.empleadoId,
          fecha: fechaDate,
          hora_inicio: toPrismaTime(effectiveStartHHMM),
          hora_fin: horaFinDate,
          proyecto: active.proyecto,
          actividad: active.actividad,
          tipo_minuta: originalTipo,
          aprobado: originalTipo === "O" ? "PE" : "SI",
          observacion: formattedObs,
          cierre_automatico: true,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
        select: { id: true },
      });

      // 7. Crear inmediatamente la nueva actividad Tipo O abierta desde la misma hora_fin
      //    relacionada con el registro recién cerrado y marcada como generada automáticamente
      const newStartTimestamp = BigInt(bogotaDateAndTimeToTimestamp(todayBogota, horario.horaFin));
      const nowBigInt = BigInt(Date.now());

      await tx.minuta_actividad_activa.update({
        where: { empleado_id: horario.empleadoId },
        data: {
          hora_inicio: horario.horaFin,
          start_timestamp: newStartTimestamp,
          tipo_minuta: "O",
          generado_automaticamente: true,
          registro_origen_id: closedRecord.id,
          updated_at: nowBigInt,
        },
      });

      // 8. Registrar log idempotente de cierre automático
      const detalleMsg = `Actividad original #${closedRecord.id} (${effectiveStartHHMM}-${horario.horaFin}, Tipo ${originalTipo}) cerrada automáticamente. Nueva actividad Tipo O abierta desde ${horario.horaFin} vinculada a #${closedRecord.id}.`;

      await tx.minuta_cierre_automatico_log.create({
        data: {
          empleado_id: horario.empleadoId,
          fecha: fechaDate,
          hora_fin_programada: horaFinDate,
          registro_cerrado_id: closedRecord.id,
          registro_nuevo_id: null,
          tipo_original: originalTipo,
          estado: "EJECUTADO",
          detalle: detalleMsg,
        },
      });

      // 9. Registrar auditoría
      await tx.minuta_auditoria.create({
        data: {
          registro_id: closedRecord.id,
          usuario: "SYSTEM_AUTO_CLOSE",
          campo: "cierre_automatico",
          valor_anterior: `Abierta desde ${effectiveStartHHMM} (Tipo ${originalTipo})`,
          valor_nuevo: `Cerrada a ${horario.horaFin} (Tipo ${originalTipo}); nueva abierta Tipo O desde ${horario.horaFin}`,
        },
      });

      return {
        empleadoId: horario.empleadoId,
        horaFinProgramada: horario.horaFin,
        estado: "EJECUTADO",
        registroCerradoId: closedRecord.id,
        tipoOriginal: originalTipo,
        detalle: detalleMsg,
      };
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return {
        empleadoId: horario.empleadoId,
        horaFinProgramada: horario.horaFin,
        estado: "OMITIDO_YA_PROCESADO",
        detalle: "Cierre automático ya procesado concurrentemente (constraint de idempotencia).",
      };
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AutoClose] Error procesando empleado ${horario.empleadoId}:`, err);
    return {
      empleadoId: horario.empleadoId,
      horaFinProgramada: horario.horaFin,
      estado: "ERROR",
      detalle: msg,
    };
  }
}

/**
 * Evalúa todos los empleados activos (activo = 'SI') cuyo horario habitual del día en curso
 * (America/Bogota) ya alcanzó hora_fin, y ejecuta el cierre automático + apertura de Tipo O
 * para quienes tengan una actividad abierta.
 */
export async function procesarCierresAutomaticos(options?: {
  referenceDate?: Date;
  onlyEmpleadoIds?: string[];
  skipSheetsSync?: boolean;
}): Promise<CierreAutomaticoResultado> {
  const nowParts = getBogotaNowParts(options?.referenceDate);
  const { horarios, inconsistencias } = await getHorariosActivosParaDia(nowParts.diaNormalizado);

  const filteredHorarios = options?.onlyEmpleadoIds?.length
    ? horarios.filter((h) => options.onlyEmpleadoIds!.includes(h.empleadoId))
    : horarios;

  // Filtrar solo aquellos cuya hora_fin ya llegó (now >= hora_fin)
  const horariosElegibles = filteredHorarios.filter(
    (h) => nowParts.totalMinutes >= h.horaFinMinutos
  );

  const result: CierreAutomaticoResultado = {
    fecha: nowParts.fecha,
    horaBogota: nowParts.hhmm,
    dia: nowParts.diaLabel,
    evaluados: horariosElegibles.length,
    ejecutados: 0,
    omitidos: 0,
    errores: 0,
    inconsistencias,
    detalles: [],
  };

  if (horariosElegibles.length === 0) {
    return result;
  }

  // Prefiltro rápido: consultar qué empleados elegibles tienen actividad abierta hoy
  const candidateIds = horariosElegibles.map((h) => h.empleadoId);
  const activeTasks = await prisma.minuta_actividad_activa.findMany({
    where: {
      empleado_id: { in: candidateIds },
      fecha: nowParts.fecha,
      generado_automaticamente: false,
    },
    select: { empleado_id: true },
  });

  const activeIdSet = new Set(activeTasks.map((t) => t.empleado_id));
  const affectedCargos = new Set<string>();

  for (const horario of horariosElegibles) {
    if (!activeIdSet.has(horario.empleadoId)) {
      result.omitidos++;
      continue;
    }

    const outcome = await ejecutarCierreTransaccional(horario, nowParts.fecha);
    result.detalles.push(outcome);

    if (outcome.estado === "EJECUTADO") {
      result.ejecutados++;
      if (horario.cargo?.trim()) {
        affectedCargos.add(horario.cargo.trim());
      }
    } else if (outcome.estado === "ERROR" || outcome.estado === "ERROR_SOLAPAMIENTO") {
      result.errores++;
    } else {
      result.omitidos++;
    }
  }

  // Sincronizar con Google Sheets de manera asíncrona si hubo cierres ejecutados
  if (result.ejecutados > 0 && !options?.skipSheetsSync) {
    try {
      const cargosList = Array.from(affectedCargos);
      sheetsSyncQueue.enqueue(cargosList.length > 0 ? cargosList : undefined);
    } catch (syncErr) {
      console.warn("[AutoClose] Error al encolar sincronización con Google Sheets:", syncErr);
    }
  }

  return result;
}
