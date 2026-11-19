import prisma from "@/lib/prisma";

export const BOGOTA_TIMEZONE = "America/Bogota";

const WEEKDAY_MAP: Record<string, { index: number; normalized: string; label: string }> = {
  sun: { index: 0, normalized: "domingo", label: "Domingo" },
  mon: { index: 1, normalized: "lunes", label: "Lunes" },
  tue: { index: 2, normalized: "martes", label: "Martes" },
  wed: { index: 3, normalized: "miercoles", label: "Miércoles" },
  thu: { index: 4, normalized: "jueves", label: "Jueves" },
  fri: { index: 5, normalized: "viernes", label: "Viernes" },
  sat: { index: 6, normalized: "sabado", label: "Sábado" },
};

export interface BogotaDateTimeParts {
  fecha: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  hhmm: string; // HH:MM
  totalMinutes: number;
  weekdayIndex: number; // 0 = Domingo .. 6 = Sábado
  diaNormalizado: string; // lunes, martes, miercoles, jueves, viernes, sabado, domingo
  diaLabel: string; // Lunes, Martes, Miércoles, ...
}

export interface HorarioEmpleadoActivo {
  empleadoId: string;
  apellidoNombre: string;
  nombreSaludo: string;
  cargo: string | null;
  dia: string;
  diaNormalizado: string;
  horaInicio: string; // HH:MM
  horaFin: string; // HH:MM
  horaInicioMinutos: number;
  horaFinMinutos: number;
}

export interface HorarioInconsistencia {
  tipo:
    | "ID_NULO_O_VACIO"
    | "DUPLICADO_ID_DIA_IGUAL"
    | "DUPLICADO_ID_DIA_CONFLICTO"
    | "HORARIO_SIN_EMPLEADO"
    | "HORARIO_EMPLEADO_INACTIVO"
    | "EMPLEADO_ACTIVO_SIN_HORARIO"
    | "HORAS_INVALIDAS"
    | "DIFERENCIA_DATOS";
  empleadoId: string | null;
  dia?: string | null;
  detalle: string;
  datos?: Record<string, unknown>;
}

/**
 * Normaliza un nombre de día de la semana (sin tildes, minúsculas, sin espacios).
 */
export function normalizeDiaSemana(dia: string | null | undefined): string {
  if (!dia) return "";
  return dia
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Valida de forma estricta que un empleado esté activo (activo = 'SI').
 */
export function isEmpleadoActivo(activo: string | null | undefined): boolean {
  return String(activo ?? "").trim().toUpperCase() === "SI";
}

/**
 * Formatea el nombre del empleado en Title Case limpio para saludos en notificaciones.
 */
export function formatNombreSaludo(apellidoNombre: string | null | undefined): string {
  const cleaned = String(apellidoNombre ?? "").trim().replace(/\s+/g, " ");
  if (!cleaned) return "colaborador";
  return cleaned
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

/**
 * Convierte HH:MM (o HH:MM:SS) a minutos desde medianoche.
 */
export function timeStringToMinutes(timeStr: string): number {
  const parts = timeStr.trim().split(":");
  const h = parseInt(parts[0] || "0", 10);
  const m = parseInt(parts[1] || "0", 10);
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 60 + m;
}

/**
 * Convierte minutos desde medianoche a formato HH:MM.
 */
export function minutesToTimeString(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Convierte un campo TIME proveniente de PostgreSQL (Date o string "HH:MM:SS") a "HH:MM".
 */
export function pgTimeToHHMM(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
    if (match) {
      return `${match[1].padStart(2, "0")}:${match[2]}`;
    }
    return "";
  }
  const h = String(value.getUTCHours()).padStart(2, "0");
  const m = String(value.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Obtiene fecha, hora y día de la semana actuales en zona horaria America/Bogota.
 */
export function getBogotaNowParts(referenceDate: Date = new Date()): BogotaDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BOGOTA_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  });

  const parts = formatter.formatToParts(referenceDate);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";

  const year = parseInt(get("year"), 10);
  const month = parseInt(get("month"), 10);
  const day = parseInt(get("day"), 10);
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // Intl en-US puede devolver "24" en medianoche
  const minute = parseInt(get("minute"), 10);
  const second = parseInt(get("second"), 10);

  const weekdayKey = get("weekday").toLowerCase().slice(0, 3);
  const weekdayInfo = WEEKDAY_MAP[weekdayKey] || WEEKDAY_MAP.mon;

  const fecha = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return {
    fecha,
    year,
    month,
    day,
    hour,
    minute,
    second,
    hhmm,
    totalMinutes: hour * 60 + minute,
    weekdayIndex: weekdayInfo.index,
    diaNormalizado: weekdayInfo.normalized,
    diaLabel: weekdayInfo.label,
  };
}

/**
 * Convierte fecha (YYYY-MM-DD) y hora (HH:MM) en America/Bogota (UTC-5 fijo, sin DST) a Unix ms.
 */
export function bogotaDateAndTimeToTimestamp(fecha: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => n.padStart(2, "0"));
  const iso = `${fecha}T${h}:${m}:00-05:00`;
  const ts = Date.parse(iso);
  return isNaN(ts) ? Date.now() : ts;
}

/**
 * Construye Date UTC para columnas @db.Date de Prisma (YYYY-MM-DDT00:00:00.000Z).
 */
export function toPrismaDate(fechaYYYYMMDD: string): Date {
  return new Date(`${fechaYYYYMMDD}T00:00:00.000Z`);
}

/**
 * Construye Date UTC para columnas @db.Time de Prisma (1970-01-01THH:MM:00.000Z).
 */
export function toPrismaTime(hhmm: string): Date {
  const clean = hhmm.trim().slice(0, 5);
  return new Date(`1970-01-01T${clean}:00.000Z`);
}

/**
 * Busca un empleado estrictamente por su número de documento (id) y verifica que activo = 'SI'.
 * Nunca busca ni relaciona por correo electrónico.
 */
export async function getEmpleadoActivoPorId(empleadoId: string) {
  const cleanId = empleadoId?.trim();
  if (!cleanId) return null;

  const empleado = await prisma.minuta_empleado.findUnique({
    where: { id: cleanId },
    select: {
      id: true,
      apellido_nombre: true,
      cargo: true,
      activo: true,
      es_lider: true,
    },
  });

  if (!empleado || !isEmpleadoActivo(empleado.activo)) {
    return null;
  }

  return empleado;
}

interface RawHorarioJoinRow {
  empleado_id: string;
  emp_nombre: string;
  emp_cargo: string | null;
  dia: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  horario_cargo: string | null;
  horario_nombre: string | null;
}

/**
 * Obtiene los horarios vigentes del día indicado para empleados con activo = 'SI',
 * relacionando public.horarios con public.minuta_empleado exclusivamente por número de documento (id).
 * Si existen filas duplicadas para el mismo (id, dia):
 *  - Si los horarios son idénticos: deduplica a 1 entrada y reporta la inconsistencia.
 *  - Si los horarios difieren: omite ese (id, dia) para evitar acciones erróneas y reporta el conflicto.
 */
export async function getHorariosActivosParaDia(diaNormalizado: string): Promise<{
  horarios: HorarioEmpleadoActivo[];
  inconsistencias: HorarioInconsistencia[];
}> {
  const targetDia = normalizeDiaSemana(diaNormalizado);
  const inconsistencias: HorarioInconsistencia[] = [];

  const rows = await prisma.$queryRaw<RawHorarioJoinRow[]>`
    SELECT
      TRIM(e.id) AS empleado_id,
      e.apellido_nombre AS emp_nombre,
      e.cargo AS emp_cargo,
      h.dia AS dia,
      to_char(h.hora_inicio, 'HH24:MI') AS hora_inicio,
      to_char(h.hora_fin, 'HH24:MI') AS hora_fin,
      h.cargo AS horario_cargo,
      h.apellido_nombre AS horario_nombre
    FROM public.horarios h
    INNER JOIN public.minuta_empleado e
      ON TRIM(e.id) = TRIM(h.id::text)
    WHERE h.id IS NOT NULL
      AND TRIM(h.id::text) <> ''
      AND UPPER(TRIM(COALESCE(e.activo, ''))) = 'SI'
  `;

  const grouped = new Map<string, RawHorarioJoinRow[]>();

  for (const row of rows) {
    if (normalizeDiaSemana(row.dia) !== targetDia) continue;

    if (!row.hora_inicio || !row.hora_fin) {
      inconsistencias.push({
        tipo: "HORAS_INVALIDAS",
        empleadoId: row.empleado_id,
        dia: row.dia,
        detalle: `Horario con hora_inicio o hora_fin nula para documento ${row.empleado_id} (${row.emp_nombre}) en ${row.dia}.`,
      });
      continue;
    }

    const startMin = timeStringToMinutes(row.hora_inicio);
    const endMin = timeStringToMinutes(row.hora_fin);
    if (startMin < 0 || endMin < 0 || endMin <= startMin) {
      inconsistencias.push({
        tipo: "HORAS_INVALIDAS",
        empleadoId: row.empleado_id,
        dia: row.dia,
        detalle: `Horario inválido (${row.hora_inicio} - ${row.hora_fin}) para documento ${row.empleado_id} en ${row.dia}.`,
      });
      continue;
    }

    const list = grouped.get(row.empleado_id) || [];
    list.push(row);
    grouped.set(row.empleado_id, list);
  }

  const horarios: HorarioEmpleadoActivo[] = [];

  for (const [empleadoId, empRows] of Array.from(grouped.entries())) {
    if (empRows.length > 1) {
      const uniqueRanges = new Set(empRows.map((r) => `${r.hora_inicio}-${r.hora_fin}`));
      if (uniqueRanges.size > 1) {
        inconsistencias.push({
          tipo: "DUPLICADO_ID_DIA_CONFLICTO",
          empleadoId,
          dia: empRows[0].dia,
          detalle: `Conflicto: el documento ${empleadoId} (${empRows[0].emp_nombre}) tiene ${empRows.length} horarios distintos para ${empRows[0].dia}: ${Array.from(uniqueRanges).join(", ")}. Se omite hasta corrección en public.horarios.`,
          datos: { rangos: Array.from(uniqueRanges) },
        });
        continue;
      } else {
        inconsistencias.push({
          tipo: "DUPLICADO_ID_DIA_IGUAL",
          empleadoId,
          dia: empRows[0].dia,
          detalle: `Duplicado con mismo horario (${empRows[0].hora_inicio}-${empRows[0].hora_fin}) para documento ${empleadoId} en ${empRows[0].dia}. Se procesa una sola vez.`,
        });
      }
    }

    const chosen = empRows[0];
    const horaInicio = chosen.hora_inicio!;
    const horaFin = chosen.hora_fin!;

    horarios.push({
      empleadoId,
      apellidoNombre: chosen.emp_nombre,
      nombreSaludo: formatNombreSaludo(chosen.emp_nombre),
      cargo: chosen.emp_cargo,
      dia: chosen.dia || targetDia,
      diaNormalizado: targetDia,
      horaInicio,
      horaFin,
      horaInicioMinutos: timeStringToMinutes(horaInicio),
      horaFinMinutos: timeStringToMinutes(horaFin),
    });
  }

  return { horarios, inconsistencias };
}

/**
 * Inspecciona y reporta todas las inconsistencias entre public.horarios y public.minuta_empleado
 * sin modificar ningún registro en la base de datos.
 */
export async function detectarInconsistenciasHorarios(): Promise<{
  totalInconsistencias: number;
  resumen: Record<string, number>;
  inconsistencias: HorarioInconsistencia[];
}> {
  const inconsistencias: HorarioInconsistencia[] = [];

  // 1. Filas en horarios sin documento (id NULL o vacío)
  const nullIdRows = await prisma.$queryRaw<
    { apellido_nombre: string | null; dia: string | null; cargo: string | null }[]
  >`
    SELECT apellido_nombre, dia, cargo
    FROM public.horarios
    WHERE id IS NULL OR TRIM(id::text) = ''
    ORDER BY apellido_nombre, dia
  `;
  for (const r of nullIdRows) {
    inconsistencias.push({
      tipo: "ID_NULO_O_VACIO",
      empleadoId: null,
      dia: r.dia,
      detalle: `Fila en public.horarios sin documento (id NULL/vacío): ${r.apellido_nombre || "Sin nombre"} (${r.cargo || "Sin cargo"}) - ${r.dia || "Sin día"}.`,
    });
  }

  // 2. Duplicados por (id, dia normalizado)
  const allWithId = await prisma.$queryRaw<
    {
      id: string;
      dia: string | null;
      hora_inicio: string | null;
      hora_fin: string | null;
      apellido_nombre: string | null;
      cargo: string | null;
    }[]
  >`
    SELECT
      TRIM(id::text) AS id,
      dia,
      to_char(hora_inicio, 'HH24:MI') AS hora_inicio,
      to_char(hora_fin, 'HH24:MI') AS hora_fin,
      apellido_nombre,
      cargo
    FROM public.horarios
    WHERE id IS NOT NULL AND TRIM(id::text) <> ''
  `;

  const byIdDia = new Map<string, typeof allWithId>();
  for (const row of allWithId) {
    if (!row.hora_inicio || !row.hora_fin || timeStringToMinutes(row.hora_fin) <= timeStringToMinutes(row.hora_inicio)) {
      inconsistencias.push({
        tipo: "HORAS_INVALIDAS",
        empleadoId: row.id,
        dia: row.dia,
        detalle: `Horas inválidas (${row.hora_inicio || "NULL"} - ${row.hora_fin || "NULL"}) para documento ${row.id} en ${row.dia || "Sin día"}.`,
      });
    }
    const key = `${row.id}::${normalizeDiaSemana(row.dia)}`;
    const arr = byIdDia.get(key) || [];
    arr.push(row);
    byIdDia.set(key, arr);
  }

  for (const [, group] of Array.from(byIdDia.entries())) {
    if (group.length > 1) {
      const ranges = Array.from(new Set(group.map((g) => `${g.hora_inicio}-${g.hora_fin}`)));
      const hasConflict = ranges.length > 1;
      inconsistencias.push({
        tipo: hasConflict ? "DUPLICADO_ID_DIA_CONFLICTO" : "DUPLICADO_ID_DIA_IGUAL",
        empleadoId: group[0].id,
        dia: group[0].dia,
        detalle: hasConflict
          ? `Conflicto de horarios duplicados para documento ${group[0].id} en ${group[0].dia}: ${ranges.join(" vs ")}.`
          : `Filas duplicadas con el mismo horario (${ranges[0]}) para documento ${group[0].id} en ${group[0].dia}.`,
        datos: {
          cantidad: group.length,
          nombres: Array.from(new Set(group.map((g) => g.apellido_nombre))),
          rangos: ranges,
        },
      });
    }
  }

  // 3. IDs en horarios sin registro en minuta_empleado
  const orphanRows = await prisma.$queryRaw<
    { id: string; apellido_nombre: string | null; cargo: string | null }[]
  >`
    SELECT DISTINCT TRIM(h.id::text) AS id, h.apellido_nombre, h.cargo
    FROM public.horarios h
    LEFT JOIN public.minuta_empleado e ON TRIM(e.id) = TRIM(h.id::text)
    WHERE h.id IS NOT NULL AND TRIM(h.id::text) <> '' AND e.id IS NULL
  `;
  for (const r of orphanRows) {
    inconsistencias.push({
      tipo: "HORARIO_SIN_EMPLEADO",
      empleadoId: r.id,
      detalle: `Documento ${r.id} (${r.apellido_nombre || "Sin nombre"}) existe en public.horarios pero no en public.minuta_empleado.`,
    });
  }

  // 4. Horarios asociados a empleados inactivos (activo <> 'SI')
  const inactiveHorarioRows = await prisma.$queryRaw<
    { id: string; emp_nombre: string; activo: string | null }[]
  >`
    SELECT DISTINCT TRIM(e.id) AS id, e.apellido_nombre AS emp_nombre, e.activo
    FROM public.horarios h
    INNER JOIN public.minuta_empleado e ON TRIM(e.id) = TRIM(h.id::text)
    WHERE h.id IS NOT NULL AND TRIM(h.id::text) <> ''
      AND UPPER(TRIM(COALESCE(e.activo, ''))) <> 'SI'
  `;
  for (const r of inactiveHorarioRows) {
    inconsistencias.push({
      tipo: "HORARIO_EMPLEADO_INACTIVO",
      empleadoId: r.id,
      detalle: `Empleado inactivo (activo='${r.activo ?? "NULL"}') con documento ${r.id} (${r.emp_nombre}) aún tiene filas en public.horarios. Será excluido automáticamente.`,
    });
  }

  // 5. Empleados activos sin horario configurado
  const activeWithoutHorarios = await prisma.$queryRaw<
    { id: string; apellido_nombre: string; cargo: string | null }[]
  >`
    SELECT TRIM(e.id) AS id, e.apellido_nombre, e.cargo
    FROM public.minuta_empleado e
    LEFT JOIN public.horarios h ON TRIM(h.id::text) = TRIM(e.id)
    WHERE UPPER(TRIM(COALESCE(e.activo, ''))) = 'SI'
      AND h.id IS NULL
    ORDER BY e.apellido_nombre
  `;
  for (const r of activeWithoutHorarios) {
    inconsistencias.push({
      tipo: "EMPLEADO_ACTIVO_SIN_HORARIO",
      empleadoId: r.id,
      detalle: `Empleado activo (activo='SI') con documento ${r.id} (${r.apellido_nombre}, ${r.cargo || "Sin cargo"}) no tiene horario en public.horarios.`,
    });
  }

  // 6. Diferencias de nombre o cargo entre horarios y minuta_empleado para el mismo documento
  const diffRows = await prisma.$queryRaw<
    {
      id: string;
      h_nombre: string | null;
      e_nombre: string;
      h_cargo: string | null;
      e_cargo: string | null;
    }[]
  >`
    SELECT DISTINCT
      TRIM(e.id) AS id,
      h.apellido_nombre AS h_nombre,
      e.apellido_nombre AS e_nombre,
      h.cargo AS h_cargo,
      e.cargo AS e_cargo
    FROM public.horarios h
    INNER JOIN public.minuta_empleado e ON TRIM(e.id) = TRIM(h.id::text)
    WHERE LOWER(TRIM(COALESCE(h.apellido_nombre, ''))) <> LOWER(TRIM(COALESCE(e.apellido_nombre, '')))
       OR LOWER(TRIM(COALESCE(h.cargo, ''))) <> LOWER(TRIM(COALESCE(e.cargo, '')))
  `;
  for (const r of diffRows) {
    inconsistencias.push({
      tipo: "DIFERENCIA_DATOS",
      empleadoId: r.id,
      detalle: `Documento ${r.id}: diferencia entre horarios ('${r.h_nombre}' / '${r.h_cargo}') y minuta_empleado ('${r.e_nombre}' / '${r.e_cargo}').`,
    });
  }

  const resumen: Record<string, number> = {};
  for (const inc of inconsistencias) {
    resumen[inc.tipo] = (resumen[inc.tipo] || 0) + 1;
  }

  return {
    totalInconsistencias: inconsistencias.length,
    resumen,
    inconsistencias,
  };
}
