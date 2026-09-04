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
  "TIPO DE TIEMPO",
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

/**
 * Sincronización unidireccional (PostgreSQL -> Google Sheets).
 * Actualiza las filas existentes con los datos oficiales de la Base de Datos,
 * preserva columnas manuales a la derecha (índice >= 14) y filas manuales sin ID,
 * y agrega los nuevos registros provenientes de PostgreSQL.
 * NUNCA modifica la base de datos PostgreSQL.
 */
function mergeMinutasWithSheetValues(
  dbMinutas: any[],
  existingValues: (string | number)[][]
): (string | number)[][] {
  const dbRowsMap = new Map<string, (string | number)[]>();

  dbMinutas.forEach((minuta) => {
    const actName = minuta.minuta_actividad?.nombre ?? minuta.actividad ?? "";
    const empCargo = minuta.minuta_empleado?.cargo ?? "";
    const actividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "");

    const row = [
      DAYS_OF_WEEK[minuta.fecha.getUTCDay()],
      `Tipo ${minuta.tipo_minuta}`,
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

    dbRowsMap.set(minuta.id.toString(), row);
  });

  // Si la hoja está vacía o solo tiene encabezado
  if (!existingValues || existingValues.length <= 1) {
    return [HEADERS, ...Array.from(dbRowsMap.values())];
  }

  const resultRows: (string | number)[][] = [];
  const processedDbIds = new Set<string>();

  // 1. Recorrer las filas existentes en la hoja de cálculo
  for (const existingRow of existingValues.slice(1)) {
    const rawId = existingRow[13]?.toString().trim();

    if (rawId && dbRowsMap.has(rawId)) {
      // Registro originado en la App: sobreescribir con el estado oficial de la BD
      const updatedRow = [...dbRowsMap.get(rawId)!];
      // Preservar columnas manuales adicionales de Google Sheets (a la derecha de ID_REGISTRO)
      if (existingRow.length > 14) {
        updatedRow.push(...existingRow.slice(14));
      }
      resultRows.push(updatedRow);
      processedDbIds.add(rawId);
    } else {
      // Filas manuales en Sheets sin ID o cuyo ID no está en el lote actual -> conservar intactas
      resultRows.push([...existingRow]);
    }
  }

  // 2. Agregar los nuevos registros de la BD que aún no estaban en la hoja
  dbMinutas.forEach((minuta) => {
    const idStr = minuta.id.toString();
    if (!processedDbIds.has(idStr)) {
      resultRows.push(dbRowsMap.get(idStr)!);
    }
  });

  return [HEADERS, ...resultRows];
}

export async function syncMinutasToSheets({ skipAuth = false } = {}) {
  if (!skipAuth) {
    await ensureCanExport();
  }

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
    const fileName = `Tiempos ${year} - Historial`;
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
    fileName: isNewFile ? `Archivo: Tiempos ${year} - Historial` : `Pestaña: ${sheetTitle}`,
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

  for (const [cargo, cargoMinutas] of Array.from(cargoGroups.entries())) {
    const cargoSheetTitle = sanitizeSheetTitle(cargo);
    if (!cargoSheetTitle) continue;

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
}
