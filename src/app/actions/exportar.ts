"use server";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import {
  getOrCreateSpreadsheet,
  replaceSpreadsheetValues,
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

function sanitizeFilePart(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim();
}

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
  return Math.round((diff / 36e5) * 100) / 100;
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
  const canExport = session?.user?.email?.toLowerCase() === "auditoriaycalidad@evoforma.net";

  if (!canExport) {
    throw new Error("No autorizado");
  }
}

function mergeMinutasWithSheetValues(
  dbMinutas: any[],
  existingValues: (string | number)[][]
): (string | number)[][] {
  const dbRows = dbMinutas.map((minuta) => {
    const actName = minuta.minuta_actividad?.nombre ?? minuta.actividad ?? "";
    const empCargo = minuta.minuta_empleado?.cargo ?? "";
    const actividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "");

    return [
      DAYS_OF_WEEK[minuta.fecha.getUTCDay()],
      `Tipo ${minuta.tipo_minuta}`,
      MONTHS[minuta.fecha.getUTCMonth()],
      formatDate(minuta.fecha),
      minuta.minuta_proyecto?.code ?? minuta.proyecto ?? "",
      minuta.minuta_proyecto?.nombre ?? "",
      formatTime24(minuta.hora_inicio),
      formatTime24(minuta.hora_fin),
      calculateHours(minuta.hora_inicio, minuta.hora_fin),
      minuta.minuta_empleado.apellido_nombre,
      actividadCargo,
      minuta.aprobado ?? "NO",
      minuta.observacion ?? "",
      minuta.id, // ID_REGISTRO column (index 13)
    ];
  });

  if (existingValues.length <= 1) {
    // Only header or empty
    return [HEADERS, ...dbRows];
  }

  const mergedMap = new Map<string, (string | number)[]>();

  const getCompositeKey = (fecha: string, inicio: string, fin: string, empleado: string) => {
    return `${fecha}_${inicio}_${fin}_${empleado}`;
  };

  // 1. Populate map with existing rows
  existingValues.slice(1).forEach((row) => {
    const paddedRow = [...row];
    while (paddedRow.length < 14) {
      paddedRow.push("");
    }
    const id = paddedRow[13]?.toString().trim();
    if (id) {
      mergedMap.set(`id:${id}`, paddedRow);
    } else {
      const key = getCompositeKey(
        paddedRow[3]?.toString().trim() ?? "",
        paddedRow[6]?.toString().trim() ?? "",
        paddedRow[7]?.toString().trim() ?? "",
        paddedRow[9]?.toString().trim() ?? ""
      );
      mergedMap.set(`comp:${key}`, paddedRow);
    }
  });

  // 2. Overwrite / merge with dbMinutas
  dbRows.forEach((dbRow) => {
    const dbId = dbRow[13].toString();
    const dbCompKey = getCompositeKey(
      dbRow[3].toString(),
      dbRow[6].toString(),
      dbRow[7].toString(),
      dbRow[9].toString()
    );

    if (mergedMap.has(`id:${dbId}`)) {
      mergedMap.set(`id:${dbId}`, dbRow);
    } else if (mergedMap.has(`comp:${dbCompKey}`)) {
      mergedMap.delete(`comp:${dbCompKey}`);
      mergedMap.set(`id:${dbId}`, dbRow);
    } else {
      mergedMap.set(`id:${dbId}`, dbRow);
    }
  });

  const finalRows = Array.from(mergedMap.values());

  // 3. Sort chronologically by date and start time
  const parseSheetDateAndStart = (dateStr: string, timeStr: string): number => {
    try {
      const [d, m, y] = dateStr.split("/").map(Number);
      const [h, min] = timeStr.split(":").map(Number);
      return new Date(Date.UTC(y, m - 1, d, h, min)).getTime();
    } catch (e) {
      return 0;
    }
  };

  finalRows.sort((a, b) => {
    const timeA = parseSheetDateAndStart(a[3]?.toString() ?? "", a[6]?.toString() ?? "");
    const timeB = parseSheetDateAndStart(b[3]?.toString() ?? "", b[6]?.toString() ?? "");
    return timeA - timeB;
  });

  return [HEADERS, ...finalRows];
}

export async function syncMinutasToSheets({ skipAuth = false } = {}) {
  if (!skipAuth) {
    await ensureCanExport();
  }

  const { year, start, end } = getCurrentYearRange();
  const minutas = await prisma.minuta_registro_actividad.findMany({
    where: {
      fecha: {
        gte: start,
        lt: end,
      },
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

  // Determinar la hoja de cálculo objetivo
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

  // 1. Sincronizar Pestaña Historial General
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

  // 2. Sincronizar por Cargo de Colaborador
  const cargoGroups = new Map<string, typeof minutas>();

  minutas.forEach((minuta) => {
    const cargoRaw = minuta.minuta_empleado?.cargo;
    const cargo = cargoRaw ? cargoRaw.trim() : "";

    if (!cargo) {
      console.error(
        `Advertencia de sincronización: El colaborador ${minuta.minuta_empleado?.apellido_nombre || minuta.empleado} no tiene un cargo identificado para el registro ID ${minuta.id}.`
      );
      return;
    }

    if (!cargoGroups.has(cargo)) {
      cargoGroups.set(cargo, []);
    }
    cargoGroups.get(cargo)!.push(minuta);
  });

  for (const [cargo, cargoMinutas] of Array.from(cargoGroups.entries())) {
    const cargoSheetTitle = sanitizeSheetTitle(cargo);
    if (!cargoSheetTitle) {
      console.error(`Error de sincronización: El cargo "${cargo}" no produce un nombre de pestaña válido.`);
      continue;
    }

    try {
      await ensureSheetExists(targetSpreadsheetId, cargoSheetTitle);
      const existingCargoValues = await getSheetValues(targetSpreadsheetId, cargoSheetTitle);
      const cargoValues = mergeMinutasWithSheetValues(cargoMinutas, existingCargoValues);
      await replaceSheetValues(targetSpreadsheetId, cargoSheetTitle, cargoValues);

      results.push({
        cargo: cargo,
        rows: cargoValues.length - 1,
        fileName: `Pestaña: ${cargoSheetTitle}`,
        url: `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit#gid=${cargoSheetTitle}`, // link directly or general sheet URL
      });
    } catch (err) {
      console.error(`Error de sincronización al procesar el cargo "${cargo}":`, err);
    }
  }

  revalidatePath("/exportar");

  return {
    success: true,
    year,
    totalRows: results[0]?.rows || 0,
    files: results,
    syncedAt: new Date().toISOString(),
  };
}
