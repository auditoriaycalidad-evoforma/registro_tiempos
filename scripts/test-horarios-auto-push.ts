import assert from "assert";
import fs from "fs";
import path from "path";

// Cargar .env local si no está en el entorno
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

import prisma from "../src/lib/prisma";
import {
  bogotaDateAndTimeToTimestamp,
  detectarInconsistenciasHorarios,
  formatNombreSaludo,
  getBogotaNowParts,
  getHorariosActivosParaDia,
  normalizeDiaSemana,
  toPrismaDate,
} from "../src/lib/horarios";
import {
  buildNotificationMessage,
  isWithinFiveMinuteNoticeWindow,
  procesarNotificacionesHorarios,
} from "../src/lib/pushNotifications";
import { procesarCierresAutomaticos } from "../src/lib/autoCloseActivities";

const TEST_IDS = {
  ACTIVO_P: "__TEST_DOC_ACTIVO_P__",
  ACTIVO_O: "__TEST_DOC_ACTIVO_O__",
  ACTIVO_POST: "__TEST_DOC_ACTIVO_POST__",
  ACTIVO_HIST: "__TEST_DOC_ACTIVO_HIST__",
  INACTIVO: "__TEST_DOC_INACTIVO__",
};
const ALL_TEST_IDS = Object.values(TEST_IDS);

// Fecha futura fija (Miércoles 2030-05-15 en America/Bogota) para aislar 100% de datos reales
const TEST_FECHA = "2030-05-15"; // Miércoles
const TEST_DIA = "Miércoles";

async function cleanup() {
  await prisma.$executeRaw`
    DELETE FROM public.minuta_cierre_automatico_log
    WHERE empleado_id = ANY(${ALL_TEST_IDS}::varchar[])
  `;
  await prisma.$executeRaw`
    DELETE FROM public.minuta_notificacion_log
    WHERE empleado_id = ANY(${ALL_TEST_IDS}::varchar[])
  `;
  await prisma.$executeRaw`
    DELETE FROM public.minuta_push_suscripcion
    WHERE empleado_id = ANY(${ALL_TEST_IDS}::varchar[])
  `;
  await prisma.$executeRaw`
    DELETE FROM public.minuta_actividad_activa
    WHERE empleado_id = ANY(${ALL_TEST_IDS}::varchar[])
  `;
  const testRegIds = await prisma.minuta_registro_actividad.findMany({
    where: { empleado: { in: ALL_TEST_IDS } },
    select: { id: true },
  });
  if (testRegIds.length > 0) {
    await prisma.minuta_auditoria.deleteMany({
      where: { registro_id: { in: testRegIds.map((r) => r.id) } },
    });
    await prisma.minuta_registro_actividad.deleteMany({
      where: { id: { in: testRegIds.map((r) => r.id) } },
    });
  }
  await prisma.$executeRaw`
    DELETE FROM public.horarios
    WHERE id = ANY(${ALL_TEST_IDS}::varchar[])
  `;
  await prisma.minuta_empleado.deleteMany({
    where: { id: { in: ALL_TEST_IDS } },
  });
}

async function runTests() {
  console.log("=== INICIANDO PRUEBAS INTEGRALES (HORARIOS, PUSH, CIERRE AUTOMÁTICO) ===");

  // 1. Pruebas unitarias puras de zona horaria America/Bogota y mensajes
  console.log("[1/6] Probando zona horaria America/Bogota, normalización y textos...");
  assert.strictEqual(normalizeDiaSemana("Miércoles"), "miercoles");
  assert.strictEqual(normalizeDiaSemana("SÁBADO"), "sabado");
  assert.strictEqual(formatNombreSaludo("ANDRES SANTANA"), "Andres Santana");

  // 2030-05-15 07:55:00 COT == 2030-05-15T12:55:00Z
  const ref0755 = new Date("2030-05-15T07:55:00-05:00");
  const parts0755 = getBogotaNowParts(ref0755);
  assert.strictEqual(parts0755.fecha, TEST_FECHA);
  assert.strictEqual(parts0755.hhmm, "07:55");
  assert.strictEqual(parts0755.diaNormalizado, "miercoles");

  const msgInicio = buildNotificationMessage("INICIO_JORNADA", "Andres Santana");
  assert.strictEqual(
    msgInicio.body,
    "Hola Andres Santana, en 5 minutos inicia tu jornada. Recuerda registrar tu actividad"
  );
  const msgFin = buildNotificationMessage("FIN_JORNADA", "Andres Santana");
  assert.strictEqual(
    msgFin.body,
    "Hola Andres Santana, tu horario habitual finaliza en 5 minutos. Recuerda registrar el cierre de tu actividad"
  );

  assert.strictEqual(isWithinFiveMinuteNoticeWindow(7 * 60 + 54, 8 * 60).match, false);
  assert.strictEqual(isWithinFiveMinuteNoticeWindow(7 * 60 + 55, 8 * 60).match, true);
  assert.strictEqual(isWithinFiveMinuteNoticeWindow(7 * 60 + 57, 8 * 60).match, true);
  assert.strictEqual(isWithinFiveMinuteNoticeWindow(8 * 60, 8 * 60).match, false);
  console.log("  OK: Zona horaria, normalización y textos exactos verificados.");

  // Limpiar residuos previos si existieran
  await cleanup();

  try {
    // Obtener un proyecto y una actividad reales existentes para respetar FKs (solo lectura)
    const sampleProyecto = await prisma.minuta_proyecto.findFirst({ select: { code: true } });
    const sampleActividad = await prisma.minuta_actividad.findFirst({ select: { code: true } });
    assert(sampleProyecto && sampleActividad, "Debe existir al menos un proyecto y una actividad en BD.");

    // Crear empleados sintéticos de prueba (4 activos 'SI', 1 inactivo 'NO')
    await prisma.minuta_empleado.createMany({
      data: [
        {
          id: TEST_IDS.ACTIVO_P,
          apellido_nombre: "PRUEBA ACTIVO TIPO P",
          cargo: "DISEÑO",
          email: "test_activo_p@example.invalid",
          activo: "SI",
          es_lider: "N",
          area_lider: [],
        },
        {
          id: TEST_IDS.ACTIVO_O,
          apellido_nombre: "PRUEBA ACTIVO TIPO O",
          cargo: "PLANTA",
          email: "test_activo_o@example.invalid",
          activo: "SI",
          es_lider: "N",
          area_lider: [],
        },
        {
          id: TEST_IDS.ACTIVO_POST,
          apellido_nombre: "PRUEBA POST SALIDA",
          cargo: "PLANTA",
          email: "test_activo_post@example.invalid",
          activo: "SI",
          es_lider: "N",
          area_lider: [],
        },
        {
          id: TEST_IDS.ACTIVO_HIST,
          apellido_nombre: "PRUEBA HISTORICO",
          cargo: "PLANTA",
          email: "test_activo_hist@example.invalid",
          activo: "SI",
          es_lider: "N",
          area_lider: [],
        },
        {
          id: TEST_IDS.INACTIVO,
          apellido_nombre: "PRUEBA INACTIVO",
          cargo: "DISEÑO",
          email: "test_inactivo@example.invalid",
          activo: "NO",
          es_lider: "N",
          area_lider: [],
        },
      ],
    });

    // Insertar horarios sintéticos en public.horarios con EL MISMO correo repetido para demostrar
    // que el sistema relaciona exclusivamente por documento (id) y jamás por correo
    const sharedCorreo = "correo_repetido_prueba@evoforma.net";
    for (const id of ALL_TEST_IDS) {
      await prisma.$executeRaw`
        INSERT INTO public.horarios (id, apellido_nombre, correo, dia, hora_inicio, hora_fin, cargo)
        VALUES (${id}, 'NOMBRE EN HORARIOS', ${sharedCorreo}, ${TEST_DIA}, '08:00:00'::time, '17:00:00'::time, 'PRUEBA')
      `;
    }

    // 2. Validar relación por ID y exclusión de inactivos ('NO')
    console.log("[2/6] Probando validación de empleados activos ('SI') vs inactivos ('NO') y relación por ID...");
    const { horarios } = await getHorariosActivosParaDia(TEST_DIA);
    const testHorarios = horarios.filter((h) => ALL_TEST_IDS.includes(h.empleadoId));
    assert.strictEqual(testHorarios.length, 4, "Deben incluirse exactamente los 4 empleados con activo='SI'");
    assert.strictEqual(
      testHorarios.some((h) => h.empleadoId === TEST_IDS.INACTIVO),
      false,
      "Empleado con activo='NO' NO debe aparecer en horarios activos"
    );
    console.log("  OK: 4 activos incluidos, 1 inactivo excluido, correos repetidos ignorados.");

    // 3. Probar notificaciones Push (5 min antes de inicio y salida, idempotencia y manejo de error 410)
    console.log("[3/6] Probando notificaciones push (5 min antes, sin duplicados, manejo de errores 410)...");
    await prisma.minuta_push_suscripcion.createMany({
      data: [
        {
          empleado_id: TEST_IDS.ACTIVO_P,
          endpoint: "https://push.test.invalid/ok-activo-p",
          p256dh: "test-p256dh",
          auth: "test-auth",
          activa: true,
        },
        {
          empleado_id: TEST_IDS.ACTIVO_O,
          endpoint: "https://push.test.invalid/expired-410-activo-o",
          p256dh: "test-p256dh",
          auth: "test-auth",
          activa: true,
        },
        {
          empleado_id: TEST_IDS.INACTIVO,
          endpoint: "https://push.test.invalid/inactivo-no-debe-recibir",
          p256dh: "test-p256dh",
          auth: "test-auth",
          activa: true,
        },
      ],
    });

    const delivered: Array<{ endpoint: string; payload: any }> = [];
    const mockSender = async (sub: { endpoint: string }, rawPayload: string) => {
      if (sub.endpoint.includes("expired-410")) {
        const err: any = new Error("Subscription expired");
        err.statusCode = 410;
        throw err;
      }
      delivered.push({ endpoint: sub.endpoint, payload: JSON.parse(rawPayload) });
    };

    // 07:54 -> fuera de ventana (0 envíos)
    const res0754 = await procesarNotificacionesHorarios({
      referenceDate: new Date(`${TEST_FECHA}T07:54:00-05:00`),
      customSender: mockSender,
      onlyEmpleadoIds: ALL_TEST_IDS,
    });
    assert.strictEqual(res0754.enviadas, 0);
    assert.strictEqual(delivered.length, 0);

    // 07:55 -> ventana de inicio (ACTIVO_P enviada, ACTIVO_O error 410, POST/HIST sin suscripción, INACTIVO excluido)
    const res0755 = await procesarNotificacionesHorarios({
      referenceDate: new Date(`${TEST_FECHA}T07:55:00-05:00`),
      customSender: mockSender,
      onlyEmpleadoIds: ALL_TEST_IDS,
    });
    assert.strictEqual(res0755.enviadas, 1);
    assert.strictEqual(res0755.errores, 1);
    assert.strictEqual(res0755.sinSuscripcion, 2);
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(
      delivered[0].payload.body,
      "Hola Prueba Activo Tipo P, en 5 minutos inicia tu jornada. Recuerda registrar tu actividad"
    );

    // Verificar que la suscripción 410 se desactivó automáticamente
    const expiredSub = await prisma.minuta_push_suscripcion.findUnique({
      where: { endpoint: "https://push.test.invalid/expired-410-activo-o" },
    });
    assert.strictEqual(expiredSub?.activa, false, "Suscripción con 410 debe marcarse activa=false");

    // Re-ejecutar a las 07:56 -> idempotente (0 duplicados)
    const res0756 = await procesarNotificacionesHorarios({
      referenceDate: new Date(`${TEST_FECHA}T07:56:00-05:00`),
      customSender: mockSender,
      onlyEmpleadoIds: ALL_TEST_IDS,
    });
    assert.strictEqual(res0756.enviadas, 0);
    assert.strictEqual(res0756.omitidasDuplicadas, 4);
    assert.strictEqual(delivered.length, 1, "No deben enviarse notificaciones duplicadas");

    // 16:55 -> ventana de salida (5 min antes de 17:00)
    const res1655 = await procesarNotificacionesHorarios({
      referenceDate: new Date(`${TEST_FECHA}T16:55:00-05:00`),
      customSender: mockSender,
      onlyEmpleadoIds: ALL_TEST_IDS,
    });
    assert.strictEqual(res1655.enviadas, 1);
    assert.strictEqual(delivered.length, 2);
    assert.strictEqual(
      delivered[1].payload.body,
      "Hola Prueba Activo Tipo P, tu horario habitual finaliza en 5 minutos. Recuerda registrar el cierre de tu actividad"
    );
    // Verificar que el inactivo jamás recibió nada
    assert.strictEqual(
      delivered.some((d) => d.endpoint.includes("inactivo")),
      false,
      "Empleado inactivo jamás debe recibir notificaciones push"
    );
    console.log("  OK: Push 5 min antes (inicio/salida), deduplicación, desactivación 410 y exclusión de inactivos verificados.");

    // 4. Probar cierre automático transaccional e idempotente + apertura de Tipo O
    console.log("[4/6] Probando cierre automático transaccional, preservación de P/O, vínculo y apertura de Tipo O...");
    const nowMs = BigInt(Date.now());
    await prisma.minuta_actividad_activa.createMany({
      data: [
        {
          // Activo con Tipo P abierta desde 08:30 -> debe cerrarse a 17:00 como Tipo P y abrir nueva Tipo O desde 17:00
          empleado_id: TEST_IDS.ACTIVO_P,
          proyecto: sampleProyecto.code,
          actividad: sampleActividad.code,
          hora_inicio: "08:30",
          start_timestamp: BigInt(bogotaDateAndTimeToTimestamp(TEST_FECHA, "08:30")),
          observacion: "Trabajo en planta",
          fecha: TEST_FECHA,
          tipo_minuta: "P",
          ubicacion: "Bogotá - Puente Aranda",
          updated_at: nowMs,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
        {
          // Activo con Tipo O abierta desde 14:00 -> debe cerrarse a 17:00 conservando Tipo O y abrir nueva Tipo O desde 17:00
          empleado_id: TEST_IDS.ACTIVO_O,
          proyecto: sampleProyecto.code,
          actividad: sampleActividad.code,
          hora_inicio: "14:00",
          start_timestamp: BigInt(bogotaDateAndTimeToTimestamp(TEST_FECHA, "14:00")),
          observacion: "Soporte urgente",
          fecha: TEST_FECHA,
          tipo_minuta: "O",
          ubicacion: null,
          updated_at: nowMs,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
        {
          // Activo que inició DESPUÉS de hora_fin (17:10 > 17:00) -> NO debe cerrarse automáticamente
          empleado_id: TEST_IDS.ACTIVO_POST,
          proyecto: sampleProyecto.code,
          actividad: sampleActividad.code,
          hora_inicio: "17:10",
          start_timestamp: BigInt(bogotaDateAndTimeToTimestamp(TEST_FECHA, "17:10")),
          observacion: "Post jornada",
          fecha: TEST_FECHA,
          tipo_minuta: "O",
          ubicacion: null,
          updated_at: nowMs,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
        {
          // Activo con fecha histórica -> NO debe tocarse
          empleado_id: TEST_IDS.ACTIVO_HIST,
          proyecto: sampleProyecto.code,
          actividad: sampleActividad.code,
          hora_inicio: "09:00",
          start_timestamp: BigInt(bogotaDateAndTimeToTimestamp("2030-05-14", "09:00")),
          observacion: "Día anterior",
          fecha: "2030-05-14",
          tipo_minuta: "P",
          ubicacion: null,
          updated_at: nowMs,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
        {
          // Inactivo con actividad abierta -> NO debe cerrarse automáticamente
          empleado_id: TEST_IDS.INACTIVO,
          proyecto: sampleProyecto.code,
          actividad: sampleActividad.code,
          hora_inicio: "09:00",
          start_timestamp: BigInt(bogotaDateAndTimeToTimestamp(TEST_FECHA, "09:00")),
          observacion: "Inactivo",
          fecha: TEST_FECHA,
          tipo_minuta: "P",
          ubicacion: null,
          updated_at: nowMs,
          generado_automaticamente: false,
          registro_origen_id: null,
        },
      ],
    });

    // A las 16:59 (antes de hora_fin=17:00) -> no debe cerrar nada
    const closeBefore = await procesarCierresAutomaticos({
      referenceDate: new Date(`${TEST_FECHA}T16:59:00-05:00`),
      onlyEmpleadoIds: ALL_TEST_IDS,
      skipSheetsSync: true,
    });
    assert.strictEqual(closeBefore.ejecutados, 0);

    // A las 17:00 exactas -> debe cerrar ACTIVO_P y ACTIVO_O solamente
    const closeAt1700 = await procesarCierresAutomaticos({
      referenceDate: new Date(`${TEST_FECHA}T17:00:00-05:00`),
      onlyEmpleadoIds: ALL_TEST_IDS,
      skipSheetsSync: true,
    });
    assert.strictEqual(closeAt1700.ejecutados, 2, "Solo deben ejecutarse 2 cierres (ACTIVO_P y ACTIVO_O)");
    assert.strictEqual(closeAt1700.errores, 0);

    // Verificar registro cerrado de ACTIVO_P (conservó Tipo P, cerrado exactamente a 17:00)
    const closedP = await prisma.minuta_registro_actividad.findFirst({
      where: { empleado: TEST_IDS.ACTIVO_P, fecha: toPrismaDate(TEST_FECHA) },
    });
    assert(closedP, "Debe existir registro cerrado para ACTIVO_P");
    assert.strictEqual(closedP.tipo_minuta, "P");
    assert.strictEqual(closedP.aprobado, "SI");
    assert.strictEqual(closedP.cierre_automatico, true);
    assert.strictEqual(closedP.generado_automaticamente, false);
    assert.strictEqual(closedP.hora_inicio.toISOString().slice(11, 16), "08:30");
    assert.strictEqual(closedP.hora_fin.toISOString().slice(11, 16), "17:00");

    // Verificar nueva actividad abierta Tipo O de ACTIVO_P desde 17:00 vinculada a closedP.id
    const newActiveP = await prisma.minuta_actividad_activa.findUnique({
      where: { empleado_id: TEST_IDS.ACTIVO_P },
    });
    assert(newActiveP, "Debe existir nueva actividad abierta para ACTIVO_P");
    assert.strictEqual(newActiveP.tipo_minuta, "O");
    assert.strictEqual(newActiveP.hora_inicio, "17:00");
    assert.strictEqual(newActiveP.generado_automaticamente, true);
    assert.strictEqual(newActiveP.registro_origen_id, closedP.id);
    assert.strictEqual(
      Number(newActiveP.start_timestamp),
      bogotaDateAndTimeToTimestamp(TEST_FECHA, "17:00")
    );

    // Verificar registro cerrado de ACTIVO_O (conservó Tipo O y aprobado='PE')
    const closedO = await prisma.minuta_registro_actividad.findFirst({
      where: { empleado: TEST_IDS.ACTIVO_O, fecha: toPrismaDate(TEST_FECHA) },
    });
    assert(closedO, "Debe existir registro cerrado para ACTIVO_O");
    assert.strictEqual(closedO.tipo_minuta, "O");
    assert.strictEqual(closedO.aprobado, "PE");
    assert.strictEqual(closedO.cierre_automatico, true);

    const newActiveO = await prisma.minuta_actividad_activa.findUnique({
      where: { empleado_id: TEST_IDS.ACTIVO_O },
    });
    assert.strictEqual(newActiveO?.tipo_minuta, "O");
    assert.strictEqual(newActiveO?.generado_automaticamente, true);
    assert.strictEqual(newActiveO?.registro_origen_id, closedO.id);

    // Verificar que POST, HIST e INACTIVO NO se modificaron ni cerraron
    const untouchedClosed = await prisma.minuta_registro_actividad.count({
      where: {
        empleado: { in: [TEST_IDS.ACTIVO_POST, TEST_IDS.ACTIVO_HIST, TEST_IDS.INACTIVO] },
      },
    });
    assert.strictEqual(untouchedClosed, 0, "POST, HIST e INACTIVO no deben generar cierres automáticos");

    // 5. Probar idempotencia del cierre automático al re-ejecutar a las 17:01 y 17:05
    console.log("[5/6] Probando idempotencia del cierre automático...");
    const closeAgain = await procesarCierresAutomaticos({
      referenceDate: new Date(`${TEST_FECHA}T17:05:00-05:00`),
      onlyEmpleadoIds: ALL_TEST_IDS,
      skipSheetsSync: true,
    });
    assert.strictEqual(closeAgain.ejecutados, 0, "Re-ejecución no debe crear cierres duplicados");

    const totalClosedAfterRetry = await prisma.minuta_registro_actividad.count({
      where: { empleado: { in: [TEST_IDS.ACTIVO_P, TEST_IDS.ACTIVO_O] } },
    });
    assert.strictEqual(totalClosedAfterRetry, 2, "Debe mantenerse exactamente 1 registro cerrado por empleado");
    console.log("  OK: Cierre automático transaccional, preservación P/O, vínculo origen->nuevo e idempotencia verificados.");

    // 6. Probar reporte de diagnóstico de inconsistencias (solo lectura)
    console.log("[6/6] Probando reporte de diagnóstico de inconsistencias sin alterar registros...");
    const diag = await detectarInconsistenciasHorarios();
    assert(typeof diag.totalInconsistencias === "number");
    assert(
      diag.inconsistencias.some((i) => i.tipo === "HORARIO_EMPLEADO_INACTIVO" && i.empleadoId === TEST_IDS.INACTIVO),
      "El diagnóstico debe detectar horarios asociados a empleados inactivos"
    );
    console.log("  OK: Diagnóstico de inconsistencias operativo.");
  } finally {
    await cleanup();
    // Verificar limpieza total
    const remaining = await prisma.minuta_empleado.count({
      where: { id: { in: ALL_TEST_IDS } },
    });
    assert.strictEqual(remaining, 0, "Todos los datos sintéticos de prueba deben quedar eliminados");
    await prisma.$disconnect();
  }

  console.log("=== TODAS LAS PRUEBAS PASARON EXITOSAMENTE (0 ERRORES, BD LIMPIA) ===");
}

runTests().catch((err) => {
  console.error("FALLO EN PRUEBAS:", err);
  process.exit(1);
});
