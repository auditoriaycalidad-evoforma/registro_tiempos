"use server";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import {
  getOrCreateSpreadsheet,
  replaceSpreadsheetValues,
  ensureSheetExists,
  replaceSheetValues,
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

  const grouped = new Map<string, typeof minutas>();

  for (const minuta of minutas) {
    const cargo = minuta.minuta_empleado.cargo?.trim() || "SIN CARGO";
    const rows = grouped.get(cargo) ?? [];
    rows.push(minuta);
    grouped.set(cargo, rows);
  }

  const results: SyncResult[] = [];
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (spreadsheetId) {
    // Modo de hoja única: se exporta cada cargo en una pestaña (sheet) del documento común
    for (const [cargo, rows] of Array.from(grouped)) {
      const sheetTitle = sanitizeFilePart(cargo);
      
      // Aseguramos que la pestaña exista antes de escribir los datos
      await ensureSheetExists(spreadsheetId, sheetTitle);

      const values = [
        HEADERS,
        ...rows.map((minuta) => [
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
        ]),
      ];

      await replaceSheetValues(spreadsheetId, sheetTitle, values);
      results.push({
        cargo,
        rows: rows.length,
        fileName: `Pestaña: ${sheetTitle}`,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      });
    }
  } else {
    // Modo multi-archivo: se crea un archivo de Google Sheets independiente por cargo
    for (const [cargo, rows] of Array.from(grouped)) {
      const fileName = `Tiempos ${year} - ${sanitizeFilePart(cargo)}`;
      const spreadsheet = await getOrCreateSpreadsheet(fileName);
      const values = [
        HEADERS,
        ...rows.map((minuta) => [
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
        ]),
      ];

      await replaceSpreadsheetValues(spreadsheet.id, values);
      results.push({
        cargo,
        rows: rows.length,
        fileName: spreadsheet.name,
        url: spreadsheet.url,
      });
    }
  }

  revalidatePath("/exportar");

  return {
    success: true,
    year,
    totalRows: minutas.length,
    files: results,
    syncedAt: new Date().toISOString(),
  };
}
