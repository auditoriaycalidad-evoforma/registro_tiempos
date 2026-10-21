"use server";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import {
  getOrCreateSpreadsheet,
  ensureSheetExists,
  replaceSheetValues,
  getSheetValues,
} from "@/lib/googleSheets";
import { formatTime24 } from "@/lib/formatTime";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";

const HEADERS = [
  "DÍA",
  "TIPO DE REGISTRO",
  "MES",
  "FECHA",
  "CÉDULA DEL PROYECTO",
  "NOMBRE DEL PROYECTO",
  "HORA INICIO",
  "HORA FIN",
  "TOTAL HORAS",
  "APELLIDO - NOMBRE",
  "ACTIVIDAD - CARGO",
  "ESTADO",
  "OBSERVACIÓN",
  "ID_REGISTRO",
];

const DAYS_OF_WEEK = [
  "DOMINGO",
  "LUNES",
  "MARTES",
  "MIÉRCOLES",
  "JUEVES",
  "VIERNES",
  "SÁBADO",
];

const MONTHS = [
  "ENERO",
  "FEBRERO",
  "MARZO",
  "ABRIL",
  "MAYO",
  "JUNIO",
  "JULIO",
  "AGOSTO",
  "SEPTIEMBRE",
  "OCTUBRE",
  "NOVIEMBRE",
  "DICIEMBRE",
];

type SyncResult = {
  cargo: string;
  rows: number;
  fileName: string;
  url: string;
};

function sanitizeSheetTitle(title: string): string {
  let sanitized = title
    .replace(/[\\/\?\*:\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.startsWith("'")) {
    sanitized = sanitized.substring(1);
  }
  if (sanitized.endsWith("'")) {
    sanitized = sanitized.substring(0, sanitized.length - 1);
  }
  return sanitized.trim().substring(0, 100);
}

function formatDate(date: Date) {
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const year = date.getUTCFullYear();

  return `${day}/${month}/${year}`;
}

function calculateHours(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.round((diff / 36e5) * 100) / 100);
}

function getCurrentYearRange() {
  const year = new Date().getFullYear();

  return {
    year,
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

async function ensureCanExport() {
  const session = await getServerSession(authOptions);
  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session?.user?.email?.toLowerCase();
  const canExport = !!(userEmail && allowedEmails.includes(userEmail));

  if (!canExport) {
    throw new Error("No autorizado");
  }
}

// Mutex en memoria para evitar condiciones de carrera entre sincronizaciones concurrentes
let currentSyncLock = Promise.resolve<any>(null);

async function runWithSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const previousLock = currentSyncLock;
  let release: () => void;
  const newLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  currentSyncLock = newLock;

  try {
    await previousLock.catch(() => {});
    return await fn();
  } finally {
    release!();
  }
}

/**
 * Sincronización unidireccional (PostgreSQL -> Google Sheets).
 * La aplicación / PostgreSQL es la ÚNICA FUENTE DE LA VERDAD.
 * - Cada registro de la BD aparece EXACTAMENTE UNA VEZ en la hoja de cálculo.
 * - Elimina de raíz cualquier duplicado previo (mismo ID o mismo contenido).
 * - Purga registros eliminados de la BD.
 * - Preserva columnas manuales a la derecha de ID_REGISTRO (índice >= 14).
 * - Preserva filas manuales legítimas sin ID agregadas externamente.
 * - Ordena cronológicamente (Fecha asc, Hora Inicio asc, ID asc).
 */
function mergeMinutasWithSheetValues(
  dbMinutas: any[],
  existingValues: (string | number)[][]
): (string | number)[][] {
  // Ordenar los registros de BD cronológicamente
  const sortedDb = [...dbMinutas].sort((a, b) => {
    const dDiff = a.fecha.getTime() - b.fecha.getTime();
    if (dDiff !== 0) return dDiff;
    const hDiff = a.hora_inicio.getTime() - b.hora_inicio.getTime();
    if (hDiff !== 0) return hDiff;
    return a.id - b.id;
  });

  const manualColsByDbId = new Map<string, (string | number)[]>();
  const manualRowsWithoutDbId: (string | number)[][] = [];

  if (existingValues && existingValues.length > 1) {
    for (const existingRow of existingValues.slice(1)) {
      const rawId = existingRow[13]?.toString().trim();
      const numId = Number(rawId);
      const isAppRecordId = Boolean(rawId && !isNaN(numId) && numId > 0);

      if (isAppRecordId) {
        // Preservar columnas manuales adicionales de Google Sheets (a la derecha de ID_REGISTRO)
        if (existingRow.length > 14 && !manualColsByDbId.has(rawId)) {
          const extraCols = existingRow.slice(14);
          if (extraCols.some(c => c !== undefined && c !== null && c.toString().trim() !== "")) {
            manualColsByDbId.set(rawId, extraCols);
          }
        }
      } else {
        // Fila sin ID: verificar si no es un registro duplicado de la BD sin ID
        const hasContent = existingRow.some(
          (cell) => cell !== undefined && cell !== null && cell.toString().trim() !== ""
        );
        if (hasContent) {
          const rowFecha = existingRow[3]?.toString().trim();
          const rowInicio = existingRow[6]?.toString().trim();
          const rowFin = existingRow[7]?.toString().trim();
          const rowEmpleado = existingRow[9]?.toString().trim().toUpperCase();
          const rowProyecto = existingRow[4]?.toString().trim().toUpperCase();

          const matchesDb = sortedDb.some(m => {
            const mFecha = formatDate(m.fecha);
            const mInicio = formatTime24(m.hora_inicio);
            const mFin = formatTime24(m.hora_fin);
            const mEmpleado = (m.minuta_empleado?.apellido_nombre ?? m.empleado ?? "").toUpperCase();
            const mProyecto = (m.minuta_proyecto?.code ?? m.proyecto ?? "").toUpperCase();
            return mFecha === rowFecha && mInicio === rowInicio && mFin === rowFin && mEmpleado === rowEmpleado && mProyecto === rowProyecto;
          });

          if (!matchesDb) {
            manualRowsWithoutDbId.push([...existingRow]);
          }
        }
      }
    }
  }

  const resultRows: (string | number)[][] = [];
  const processedIds = new Set<string>();

  for (const minuta of sortedDb) {
    const idStr = minuta.id.toString();
    // GARANTÍA ANTI-DUPLICADOS: Nunca insertar el mismo ID más de una vez
    if (processedIds.has(idStr)) continue;
    processedIds.add(idStr);

    const actName = minuta.minuta_actividad?.nombre ?? minuta.actividad ?? "";
    const empCargo = minuta.minuta_empleado?.cargo ?? "";
    const actividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "");

    const row: (string | number)[] = [
      DAYS_OF_WEEK[minuta.fecha.getUTCDay()],
      `Tipo ${minuta.tipo_minuta === 'A' ? 'P' : minuta.tipo_minuta}`,
      MONTHS[minuta.fecha.getUTCMonth()],
      formatDate(minuta.fecha),
      minuta.minuta_proyecto?.code ?? minuta.proyecto ?? "",
      minuta.minuta_proyecto?.nombre ?? "",
      formatTime24(minuta.hora_inicio),
      formatTime24(minuta.hora_fin),
      calculateHours(minuta.hora_inicio, minuta.hora_fin),
      minuta.minuta_empleado?.apellido_nombre ?? minuta.empleado ?? "",
      actividadCargo,
      minuta.aprobado ?? "NO",
      minuta.observacion ?? "",
      minuta.id,
    ];

    if (manualColsByDbId.has(idStr)) {
      row.push(...manualColsByDbId.get(idStr)!);
    }

    resultRows.push(row);
  }

  // Conservar filas manuales legítimas al final
  if (manualRowsWithoutDbId.length > 0) {
    resultRows.push(...manualRowsWithoutDbId);
  }

  return [HEADERS, ...resultRows];
}

export async function syncMinutasToSheets({
  skipAuth = false,
  targetCargos,
}: {
  skipAuth?: boolean;
  targetCargos?: string[];
} = {}) {
  if (!skipAuth) {
    await ensureCanExport();
  }

  return runWithSyncLock(async () => {

  const { year, start, end } = getCurrentYearRange();

  // 1. Obtener fecha de la última sincronización
  const lastSyncAudit = await prisma.minuta_auditoria.findFirst({
    where: { campo: "sync_sheets" },
    orderBy: { fecha_cambio: "desc" },
  });
  const lastSyncTime = lastSyncAudit ? lastSyncAudit.fecha_cambio : new Date(0);

  // 2. Cargar datos maestros de la BD
  const minutas = await prisma.minuta_registro_actividad.findMany({
    where: {
      fecha: { gte: start, lt: end },
    },
    orderBy: [{ fecha: "asc" }, { hora_inicio: "asc" }],
    include: {
      minuta_empleado: true,
      minuta_proyecto: true,
      minuta_actividad: true,
    },
  });

  const results: SyncResult[] = [];
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  let targetSpreadsheetId = spreadsheetId;
  let isNewFile = false;
  let newFileUrl = "";

  if (!targetSpreadsheetId) {
    const fileName = `Registros ${year} - Historial`;
    const spreadsheet = await getOrCreateSpreadsheet(fileName);
    targetSpreadsheetId = spreadsheet.id;
    isNewFile = true;
    newFileUrl = spreadsheet.url;
  }

  // 3. Sincronización unidireccional de la pestaña Historial
  const sheetTitle = "Historial";
  await ensureSheetExists(targetSpreadsheetId, sheetTitle);
  const existingValues = await getSheetValues(targetSpreadsheetId, sheetTitle);
  const values = mergeMinutasWithSheetValues(minutas, existingValues);
  await replaceSheetValues(targetSpreadsheetId, sheetTitle, values);

  results.push({
    cargo: "TODOS",
    rows: values.length - 1,
    fileName: isNewFile ? `Archivo: Registros ${year} - Historial` : `Pestaña: ${sheetTitle}`,
    url: isNewFile ? newFileUrl : `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
  });

  // 4. Sincronización unidireccional por Cargo
  const cargoGroups = new Map<string, typeof minutas>();
  minutas.forEach((minuta) => {
    const cargoRaw = minuta.minuta_empleado?.cargo;
    const cargo = cargoRaw ? cargoRaw.trim() : "";
    if (!cargo) return;
    if (!cargoGroups.has(cargo)) {
      cargoGroups.set(cargo, []);
    }
    cargoGroups.get(cargo)!.push(minuta);
  });

  // Determinar cargos a sincronizar: todos los existentes o únicamente los indicados
  const normalizedTargetCargos = targetCargos?.map((c) => c.trim().toLowerCase()).filter(Boolean);
  const cargosToProcess = normalizedTargetCargos && normalizedTargetCargos.length > 0
    ? Array.from(cargoGroups.keys())
        .filter((c) => normalizedTargetCargos.includes(c.toLowerCase()))
        .concat(
          targetCargos!
            .map((c) => c.trim())
            .filter((c) => !Array.from(cargoGroups.keys()).some((k) => k.toLowerCase() === c.toLowerCase()))
        )
    : Array.from(cargoGroups.keys());

  for (const cargo of cargosToProcess) {
    const cargoSheetTitle = sanitizeSheetTitle(cargo);
    if (!cargoSheetTitle) continue;
    const cargoMinutas = cargoGroups.get(cargo) ?? [];

    try {
      await ensureSheetExists(targetSpreadsheetId, cargoSheetTitle);
      const existingCargoValues = await getSheetValues(targetSpreadsheetId, cargoSheetTitle);
      const cargoValues = mergeMinutasWithSheetValues(cargoMinutas, existingCargoValues);
      await replaceSheetValues(targetSpreadsheetId, cargoSheetTitle, cargoValues);

      results.push({
        cargo: cargo,
        rows: cargoValues.length - 1,
        fileName: `Pestaña: ${cargoSheetTitle}`,
        url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit#gid=${cargoSheetTitle}`,
      });
    } catch (err) {
      console.error(`Error de sincronización al procesar el cargo "${cargo}":`, err);
    }
  }

  // 5. Registrar la marca de sincronización en auditoría
  await prisma.minuta_auditoria.create({
    data: {
      registro_id: 0,
      usuario: "SYSTEM_SYNC",
      campo: "sync_sheets",
      valor_anterior: lastSyncTime.toISOString(),
      valor_nuevo: new Date().toISOString(),
    },
  });

  try {
    revalidatePath("/exportar");
    revalidatePath("/dashboard");
    revalidatePath("/admin");
    revalidatePath("/pwa");
  } catch (e) {
    // Ignore when executed outside Next.js request context
  }

    return {
      success: true,
      year,
      totalRows: results[0]?.rows || 0,
      files: results,
      syncedAt: new Date().toISOString(),
    };
  });
}

