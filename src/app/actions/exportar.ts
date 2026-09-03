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

function parseDateFromSheet(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.trim();
  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split("/").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const parsed = new Date(clean);
  if (!isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
  }
  return null;
}

function normalizeTime(timeStr: any): string {
  if (!timeStr) return "";
  const str = timeStr.toString().trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(str)) {
    const parts = str.split(":");
    const h = parts[0].padStart(2, "0");
    const m = parts[1].padStart(2, "0");
    return `${h}:${m}`;
  }
  return str;
}

function parseTimeToDate(timeStr: string): Date | null {
  const norm = normalizeTime(timeStr);
  if (/^([01]\d|2[0-3]):[0-5]\d$/.test(norm)) {
    return new Date(`1970-01-01T${norm}:00.000Z`);
  }
  return null;
}

function normalizeEstado(estadoStr: string): string {
  const s = estadoStr.toUpperCase().trim();
  if (s === "SI" || s === "APROBADO" || s === "APROBADA") return "SI";
  if (s === "RE" || s === "RECHAZADO" || s === "RECHAZADA") return "RE";
  if (s === "PE" || s === "PENDIENTE") return "PE";
  if (s === "NO") return "NO";
  return s;
}

function normalizeTipoMinuta(tipoStr: any): "A" | "O" | null {
  if (!tipoStr) return null;
  const s = tipoStr.toString().trim().toUpperCase();
  if (s === "O" || s === "TIPO O" || s.endsWith(" O")) return "O";
  if (s === "A" || s === "TIPO A" || s.endsWith(" A")) return "A";
  return null;
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

async function bidirectionalCellSync(
  dbMinutas: any[],
  existingValues: (string | number)[][],
  appModifiedFields: Set<string>,
  catalogs: {
    proyectos: any[];
    actividades: any[];
  }
): Promise<(string | number)[][]> {
  const { proyectos, actividades } = catalogs;
  const dbRowsMap = new Map<string, any>();
  dbMinutas.forEach((m) => {
    dbRowsMap.set(m.id.toString(), m);
  });

  const pendingDbUpdates = new Map<number, any>();

  // Si la hoja está vacía o no tiene datos
  if (!existingValues || existingValues.length <= 1) {
    const fullRows = dbMinutas.map((minuta) => {
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
        minuta.minuta_empleado?.apellido_nombre ?? minuta.empleado ?? "",
        actividadCargo,
        minuta.aprobado ?? "NO",
        minuta.observacion ?? "",
        minuta.id,
      ];
    });

    return [HEADERS, ...fullRows];
  }

  const resultRows: (string | number)[][] = [];
  const processedDbIds = new Set<string>();

  // 1. Recorrer y resolver celda por celda cada fila existente en Google Sheets
  for (const existingRow of existingValues.slice(1)) {
    const rawId = existingRow[13]?.toString().trim();

    if (rawId && dbRowsMap.has(rawId)) {
      const minuta = dbRowsMap.get(rawId)!;
      const idNum = minuta.id;
      const updates: Record<string, any> = {};

      // --- Celda por Celda (Delta Sync) ---

      // 1. Observación (Index 12)
      const dbObs = minuta.observacion ?? "";
      const sheetObs = existingRow[12]?.toString().trim() ?? "";
      const obsChangedInApp = appModifiedFields.has(`${idNum}:observacion`);
      let finalObs = dbObs;
      if (obsChangedInApp) {
        finalObs = dbObs; // App gana
      } else if (sheetObs !== dbObs) {
        finalObs = sheetObs; // Sheets gana, descargar a DB
        updates.observacion = sheetObs;
      }

      // 2. Estado / Aprobado (Index 11)
      const dbEstado = minuta.aprobado ?? "NO";
      const sheetEstadoRaw = existingRow[11]?.toString().trim() ?? "";
      const sheetEstado = normalizeEstado(sheetEstadoRaw);
      const estadoChangedInApp = appModifiedFields.has(`${idNum}:aprobado`);
      let finalEstado = dbEstado;
      if (estadoChangedInApp) {
        finalEstado = dbEstado;
      } else if (sheetEstado && sheetEstado !== dbEstado) {
        finalEstado = sheetEstadoRaw;
        updates.aprobado = sheetEstado;
      }

      // 3. Hora Inicio (Index 6)
      const dbHoraInicio = formatTime24(minuta.hora_inicio);
      const sheetHoraInicio = normalizeTime(existingRow[6]);
      const horaInicioChangedInApp = appModifiedFields.has(`${idNum}:hora_inicio`);
      let finalHoraInicio = dbHoraInicio;
      let effectiveHoraInicioDate = minuta.hora_inicio;
      if (horaInicioChangedInApp) {
        finalHoraInicio = dbHoraInicio;
      } else if (sheetHoraInicio && sheetHoraInicio !== dbHoraInicio) {
        const parsedTime = parseTimeToDate(sheetHoraInicio);
        if (parsedTime) {
          finalHoraInicio = sheetHoraInicio;
          effectiveHoraInicioDate = parsedTime;
          updates.hora_inicio = parsedTime;
        }
      }

      // 4. Hora Fin (Index 7)
      const dbHoraFin = formatTime24(minuta.hora_fin);
      const sheetHoraFin = normalizeTime(existingRow[7]);
      const horaFinChangedInApp = appModifiedFields.has(`${idNum}:hora_fin`);
      let finalHoraFin = dbHoraFin;
      let effectiveHoraFinDate = minuta.hora_fin;
      if (horaFinChangedInApp) {
        finalHoraFin = dbHoraFin;
      } else if (sheetHoraFin && sheetHoraFin !== dbHoraFin) {
        const parsedTime = parseTimeToDate(sheetHoraFin);
        if (parsedTime) {
          finalHoraFin = sheetHoraFin;
          effectiveHoraFinDate = parsedTime;
          updates.hora_fin = parsedTime;
        }
      }

      // 5. Fecha (Index 3)
      const dbFechaStr = formatDate(minuta.fecha);
      const sheetFechaStr = existingRow[3]?.toString().trim() ?? "";
      const fechaChangedInApp = appModifiedFields.has(`${idNum}:fecha`);
      let finalFechaStr = dbFechaStr;
      let effectiveFechaDate = minuta.fecha;
      if (fechaChangedInApp) {
        finalFechaStr = dbFechaStr;
      } else if (sheetFechaStr && sheetFechaStr !== dbFechaStr) {
        const parsedDate = parseDateFromSheet(sheetFechaStr);
        if (parsedDate) {
          finalFechaStr = formatDate(parsedDate);
          effectiveFechaDate = parsedDate;
          updates.fecha = parsedDate;
        }
      }

      // 6. Tipo de Minuta (Index 1)
      const dbTipo = minuta.tipo_minuta;
      const sheetTipoRaw = existingRow[1]?.toString().trim() ?? "";
      const sheetTipoCode = normalizeTipoMinuta(sheetTipoRaw);
      const tipoChangedInApp = appModifiedFields.has(`${idNum}:tipo_minuta`);
      let finalTipo = `Tipo ${dbTipo}`;
      if (tipoChangedInApp) {
        finalTipo = `Tipo ${dbTipo}`;
      } else if (sheetTipoCode && sheetTipoCode !== dbTipo) {
        finalTipo = `Tipo ${sheetTipoCode}`;
        updates.tipo_minuta = sheetTipoCode;
      } else {
        finalTipo = sheetTipoRaw ? (sheetTipoRaw.toUpperCase().startsWith("TIPO") ? sheetTipoRaw : `Tipo ${dbTipo}`) : `Tipo ${dbTipo}`;
      }

      // 7. Proyecto (Index 4 y 5)
      const dbProjCode = minuta.minuta_proyecto?.code ?? minuta.proyecto ?? "";
      const dbProjName = minuta.minuta_proyecto?.nombre ?? "";
      const sheetProjCode = existingRow[4]?.toString().trim() ?? "";
      const sheetProjName = existingRow[5]?.toString().trim() ?? "";
      const projChangedInApp = appModifiedFields.has(`${idNum}:proyecto`);
      let finalProjCode = dbProjCode;
      let finalProjName = dbProjName;
      if (projChangedInApp) {
        finalProjCode = dbProjCode;
        finalProjName = dbProjName;
      } else if (sheetProjCode && sheetProjCode !== dbProjCode) {
        finalProjCode = sheetProjCode;
        const foundProj = proyectos.find((p) => p.code === sheetProjCode);
        finalProjName = foundProj?.nombre ?? sheetProjName ?? sheetProjCode;
        updates.proyecto = sheetProjCode;
      } else {
        finalProjName = sheetProjName || dbProjName;
      }

      // 8. Actividad (Index 10)
      const actName = minuta.minuta_actividad?.nombre ?? minuta.actividad ?? "";
      const empCargo = minuta.minuta_empleado?.cargo ?? "";
      const dbActividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "");
      const sheetActCargo = existingRow[10]?.toString().trim() ?? "";
      const actChangedInApp = appModifiedFields.has(`${idNum}:actividad`);
      let finalActCargo = dbActividadCargo;
      if (actChangedInApp) {
        finalActCargo = dbActividadCargo;
      } else if (sheetActCargo && sheetActCargo !== dbActividadCargo) {
        finalActCargo = sheetActCargo;
        const foundAct = actividades.find((a) =>
          sheetActCargo.toLowerCase().includes(a.nombre.toLowerCase()) ||
          sheetActCargo.toLowerCase().includes(a.code.toLowerCase())
        );
        if (foundAct) {
          updates.actividad = foundAct.code;
        }
      }

      // 9. Colaborador (Index 9)
      const dbEmpName = minuta.minuta_empleado?.apellido_nombre ?? minuta.empleado ?? "";
      const sheetEmpName = existingRow[9]?.toString().trim() ?? "";
      const empChangedInApp = appModifiedFields.has(`${idNum}:empleado`);
      const finalEmpName = empChangedInApp ? dbEmpName : (sheetEmpName || dbEmpName);

      // Calcular columnas derivadas coherentes
      const finalDia = DAYS_OF_WEEK[effectiveFechaDate.getUTCDay()];
      const finalMes = MONTHS[effectiveFechaDate.getUTCMonth()];
      const finalTotalHoras = calculateHours(effectiveHoraInicioDate, effectiveHoraFinDate);

      // Si hubo cambios manuales desde Sheets para esta fila, guardarlos para actualizar la BD
      if (Object.keys(updates).length > 0) {
        pendingDbUpdates.set(idNum, updates);
      }

      // Armar la fila preservando columnas extras manuales (Index >= 14)
      const updatedRow: (string | number)[] = [
        finalDia,
        finalTipo,
        finalMes,
        finalFechaStr,
        finalProjCode,
        finalProjName,
        finalHoraInicio,
        finalHoraFin,
        finalTotalHoras,
        finalEmpName,
        finalActCargo,
        finalEstado,
        finalObs,
        idNum,
      ];

      if (existingRow.length > 14) {
        updatedRow.push(...existingRow.slice(14));
      }

      resultRows.push(updatedRow);
      processedDbIds.add(rawId);
    } else {
      // Filas manuales en Sheets sin ID o cuyo ID no está en el lote -> Preservar intactas
      resultRows.push([...existingRow]);
    }
  }

  // 2. Agregar nuevos registros de la BD que aún no estaban en Sheets
  dbMinutas.forEach((minuta) => {
    if (!processedDbIds.has(minuta.id.toString())) {
      const actName = minuta.minuta_actividad?.nombre ?? minuta.actividad ?? "";
      const empCargo = minuta.minuta_empleado?.cargo ?? "";
      const actividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "");

      resultRows.push([
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
      ]);
    }
  });

  // 3. Aplicar las actualizaciones pendientes en la base de datos (Descarga de Sheets a DB)
  for (const [id, updates] of Array.from(pendingDbUpdates.entries())) {
    try {
      await prisma.minuta_registro_actividad.update({
        where: { id },
        data: updates,
      });
    } catch (e) {
      console.error(`Error actualizando DB desde Sheets para el registro ID ${id}:`, e);
    }
  }

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

  // 2. Identificar campos modificados directamente en la App desde la última sincronización
  const recentAudits = await prisma.minuta_auditoria.findMany({
    where: {
      fecha_cambio: { gt: lastSyncTime },
      campo: { not: "sync_sheets" },
    },
  });
  const appModifiedFields = new Set<string>();
  recentAudits.forEach((audit) => {
    appModifiedFields.add(`${audit.registro_id}:${audit.campo}`);
  });

  // 3. Cargar datos de la BD y catálogos
  const [minutas, proyectos, actividades] = await Promise.all([
    prisma.minuta_registro_actividad.findMany({
      where: {
        fecha: { gte: start, lt: end },
      },
      orderBy: [{ fecha: "asc" }, { hora_inicio: "asc" }],
      include: {
        minuta_empleado: true,
        minuta_proyecto: true,
        minuta_actividad: true,
      },
    }),
    prisma.minuta_proyecto.findMany(),
    prisma.minuta_actividad.findMany(),
  ]);

  const catalogs = { proyectos, actividades };
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

  // 4. Sincronización bidireccional de la pestaña Historial
  const sheetTitle = "Historial";
  await ensureSheetExists(targetSpreadsheetId, sheetTitle);
  const existingValues = await getSheetValues(targetSpreadsheetId, sheetTitle);
  const values = await bidirectionalCellSync(minutas, existingValues, appModifiedFields, catalogs);
  await replaceSheetValues(targetSpreadsheetId, sheetTitle, values);

  results.push({
    cargo: "TODOS",
    rows: values.length - 1,
    fileName: isNewFile ? `Archivo: Tiempos ${year} - Historial` : `Pestaña: ${sheetTitle}`,
    url: isNewFile ? newFileUrl : `https://docs.google.com/spreadsheets/d/${targetSpreadsheetId}/edit`,
  });

  // 5. Sincronización bidireccional por Cargo
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
      const cargoValues = await bidirectionalCellSync(cargoMinutas, existingCargoValues, appModifiedFields, catalogs);
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

  // 6. Registrar la marca de sincronización en auditoría
  await prisma.minuta_auditoria.create({
    data: {
      registro_id: 0,
      usuario: "SYSTEM_SYNC",
      campo: "sync_sheets",
      valor_anterior: lastSyncTime.toISOString(),
      valor_nuevo: new Date().toISOString(),
    },
  });

  revalidatePath("/exportar");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  revalidatePath("/pwa");

  return {
    success: true,
    year,
    totalRows: results[0]?.rows || 0,
    files: results,
    syncedAt: new Date().toISOString(),
  };
}
