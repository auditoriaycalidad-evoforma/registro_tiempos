import prisma from "./src/lib/prisma";
import { getSheetValues } from "./src/lib/googleSheets";

interface GhostRecord {
  id: number;
  rowNumber: number;
  sheetTitle: string;
  fecha: string;
  empleado: string;
  cargo: string;
  proyecto: string;
  horas: string;
}

interface ModifiedDiscrepancy {
  id: number;
  campo: string;
  enSheets: string | number;
  enDB: string | number;
  empleado: string;
}

async function runVerification() {
  console.log("================================================================================");
  console.log("         SCRIPT DE VERIFICACIÓN DE SINCRONIZACIÓN GOOGLE SHEETS VS BD           ");
  console.log("================================================================================\n");

  // 1. Verificación de Variables de Entorno
  console.log("1. VERIFICANDO CREDENCIALES Y VARIABLES DE ENTORNO...");
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;

  if (!clientEmail || !privateKey) {
    console.error("   ✗ ERROR: Faltan credenciales de Google Service Account en .env");
    return;
  }
  if (!spreadsheetId) {
    console.error("   ✗ ERROR: GOOGLE_SPREADSHEET_ID no está configurado en .env");
    return;
  }
  console.log(`   ✓ Cuenta de Servicio: ${clientEmail}`);
  console.log(`   ✓ ID de Hoja de Cálculo: ${spreadsheetId}`);

  // 2. Análisis de pestaña "Historial"
  console.log("\n2. ANALIZANDO PESTAÑA 'Historial'...");
  let historialRows: (string | number)[][] = [];
  try {
    historialRows = await getSheetValues(spreadsheetId, "Historial");
    console.log(`   ✓ Total de filas en 'Historial': ${historialRows.length}`);
  } catch (err: any) {
    console.error(`   ✗ ERROR al obtener valores de 'Historial': ${err.message}`);
    return;
  }

  if (historialRows.length <= 1) {
    console.log("   ! La hoja está vacía o solo contiene encabezados.");
    return;
  }

  // Extraer todos los IDs presentes en la columna ID_REGISTRO (índice 13)
  const sheetRecordsMap = new Map<number, { rowIdx: number; row: (string | number)[] }>();
  const manualRowsWithoutId: number[] = [];

  historialRows.slice(1).forEach((row, idx) => {
    const rowNum = idx + 2;
    const rawId = row[13]?.toString().trim();
    const numId = Number(rawId);

    if (rawId && !isNaN(numId) && numId > 0) {
      sheetRecordsMap.set(numId, { rowIdx: rowNum, row });
    } else {
      manualRowsWithoutId.push(rowNum);
    }
  });

  console.log(`   ✓ Filas con ID_REGISTRO numérico: ${sheetRecordsMap.size}`);
  console.log(`   ✓ Filas manuales (sin ID_REGISTRO): ${manualRowsWithoutId.length}`);

  // 3. Cruzar con la Base de Datos PostgreSQL
  console.log("\n3. CONSULTANDO BASE DE DATOS POSTGRESQL PARA VALIDAR INTEGRIDAD...");
  const allSheetIds = Array.from(sheetRecordsMap.keys());
  const existingDbRecords = new Map<number, any>();

  const batchSize = 1000;
  for (let i = 0; i < allSheetIds.length; i += batchSize) {
    const batch = allSheetIds.slice(i, i + batchSize);
    const dbRows = await prisma.minuta_registro_actividad.findMany({
      where: { id: { in: batch } },
      include: {
        minuta_empleado: true,
        minuta_proyecto: true,
        minuta_actividad: true,
      },
    });
    dbRows.forEach((r) => existingDbRecords.set(r.id, r));
  }

  console.log(`   ✓ Registros verificados existentes en BD: ${existingDbRecords.size}`);

  // 4. Detección de Registros Fantasma (Eliminados en BD pero aún en Google Sheets)
  const ghostRecords: GhostRecord[] = [];
  sheetRecordsMap.forEach((meta, id) => {
    if (!existingDbRecords.has(id)) {
      ghostRecords.push({
        id,
        rowNumber: meta.rowIdx,
        sheetTitle: "Historial",
        fecha: String(meta.row[3] || ""),
        empleado: String(meta.row[9] || ""),
        cargo: String(meta.row[10] || ""),
        proyecto: String(meta.row[4] || ""),
        horas: `${meta.row[6]} a ${meta.row[7]} (${meta.row[8]} hrs)`,
      });
    }
  });

  console.log("\n================================================================================");
  console.log(`   RESULTADO DE REGISTROS FANTASMA (ELIMINADOS): ${ghostRecords.length}`);
  console.log("================================================================================");

  if (ghostRecords.length > 0) {
    console.log("\nDetalle de registros que fueron eliminados en la App pero Google Sheets conservó:");
    ghostRecords.forEach((g) => {
      console.log(
        `   • [Fila ${g.rowNumber}] ID ${g.id} | Fecha: ${g.fecha} | Empleado: ${g.empleado} | Horas: ${g.horas} | Proy: ${g.proyecto}`
      );
    });

    // Caso de estudio específico: Oscar García del 08/10/2026
    const casoOscar = ghostRecords.find(
      (g) => g.fecha.includes("08/10/2026") && g.empleado.toUpperCase().includes("OSCAR GARC")
    );
    if (casoOscar) {
      console.log("\n   ★ CASO DOCUMENTADO LOCALIZADO:");
      console.log(`     - Empleado: ${casoOscar.empleado}`);
      console.log(`     - ID de Registro eliminado: ${casoOscar.id}`);
      console.log(`     - Fila en 'Historial': ${casoOscar.rowNumber}`);
      console.log(`     - Horas registradas en la fila fantasma: ${casoOscar.horas}`);
      console.log(`     - Proyecto: ${casoOscar.proyecto}`);
    }
  } else {
    console.log("   ✓ No se encontraron registros fantasma en la pestaña Historial.");
  }

  // 5. Detección de Desfases en Registros Modificados
  console.log("\n5. EVALUANDO DESFASES EN REGISTROS MODIFICADOS...");
  const discrepancies: ModifiedDiscrepancy[] = [];

  sheetRecordsMap.forEach((meta, id) => {
    const dbRecord = existingDbRecords.get(id);
    if (!dbRecord) return;

    // Comparar aprobación
    const sheetAprobado = String(meta.row[11] || "").trim();
    const dbAprobado = String(dbRecord.aprobado || "NO").trim();
    if (sheetAprobado !== dbAprobado) {
      discrepancies.push({
        id,
        campo: "ESTADO / APROBACIÓN",
        enSheets: sheetAprobado,
        enDB: dbAprobado,
        empleado: String(meta.row[9]),
      });
    }

    // Comparar proyecto
    const sheetProy = String(meta.row[4] || "").trim();
    const dbProy = String(dbRecord.minuta_proyecto?.code ?? dbRecord.proyecto ?? "").trim();
    if (sheetProy && dbProy && sheetProy !== dbProy) {
      discrepancies.push({
        id,
        campo: "PROYECTO",
        enSheets: sheetProy,
        enDB: dbProy,
        empleado: String(meta.row[9]),
      });
    }
  });

  console.log(`   ✓ Discrepancias encontradas en modificaciones: ${discrepancies.length}`);
  if (discrepancies.length > 0) {
    discrepancies.slice(0, 10).forEach((d) => {
      console.log(`   • ID ${d.id} (${d.empleado}): Campo ${d.campo} -> Sheets='${d.enSheets}' vs DB='${d.enDB}'`);
    });
  }

  console.log("\n================================================================================");
  console.log("                         RESUMEN DEL DIAGNÓSTICO                                ");
  console.log("================================================================================");
  console.log(`1. Total filas en Sheets:                   ${historialRows.length}`);
  console.log(`2. Total registros eliminados no purgados: ${ghostRecords.length}`);
  console.log(`3. Total discrepancias en datos editados:   ${discrepancies.length}`);
  console.log("================================================================================\n");
}

runVerification()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
