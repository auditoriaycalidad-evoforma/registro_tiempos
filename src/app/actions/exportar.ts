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
  "apellido-nombre",
  "ACTIVIDAD",
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
  const dbRows = dbMinutas.map((minuta) => [
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
    minuta.minuta_actividad?.nombre ?? "",
    minuta.aprobado ?? "NO",
    minuta.observacion ?? "",
    minuta.id, // ID_REGISTRO column (index 13)
  ]);

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

  if (spreadsheetId) {
    const sheetTitle = "Historial";
    
    // Aseguramos que la pestaña existan antes de escribir
    await ensureSheetExists(spreadsheetId, sheetTitle);

    const existingValues = await getSheetValues(spreadsheetId, sheetTitle);
    const values = mergeMinutasWithSheetValues(minutas, existingValues);

    await replaceSheetValues(spreadsheetId, sheetTitle, values);
    results.push({
      cargo: "TODOS",
      rows: values.length - 1,
      fileName: `Pestaña: ${sheetTitle}`,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    });
  } else {
    // Si no hay spreadsheetId, creamos un archivo completo para el año
    const fileName = `Tiempos ${year} - Historial`;
    const spreadsheet = await getOrCreateSpreadsheet(fileName);
    
    const existingValues = await getSheetValues(spreadsheet.id);
    const values = mergeMinutasWithSheetValues(minutas, existingValues);

    await replaceSpreadsheetValues(spreadsheet.id, values);
    results.push({
      cargo: "TODOS",
      rows: values.length - 1,
      fileName: spreadsheet.name,
      url: spreadsheet.url,
    });
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
