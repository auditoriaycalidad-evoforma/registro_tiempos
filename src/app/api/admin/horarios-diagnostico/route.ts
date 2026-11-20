import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAuthorizedAuditor } from "@/app/actions/minuta";
import prisma from "@/lib/prisma";
import { detectarInconsistenciasHorarios, getBogotaNowParts } from "@/lib/horarios";
import { getVapidConfig } from "@/lib/pushNotifications";
import { getSchedulerStatus } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/horarios-diagnostico
 * Reporte de solo lectura para administradores:
 *  - Inconsistencias entre public.horarios y public.minuta_empleado (sin alterar registros)
 *  - Estado del scheduler en backend y configuración VAPID
 *  - Resumen y últimos registros de envíos push (exitosos y errores) y cierres automáticos
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id || !(await isAuthorizedAuditor(session))) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }

    const [
      diagnostico,
      ultimasNotificaciones,
      resumenNotificaciones,
      ultimosCierres,
      suscripcionesActivas,
    ] = await Promise.all([
      detectarInconsistenciasHorarios(),
      prisma.minuta_notificacion_log.findMany({
        orderBy: { created_at: "desc" },
        take: 100,
      }),
      prisma.minuta_notificacion_log.groupBy({
        by: ["estado"],
        _count: { _all: true },
      }),
      prisma.minuta_cierre_automatico_log.findMany({
        orderBy: { created_at: "desc" },
        take: 50,
      }),
      prisma.minuta_push_suscripcion.findMany({
        where: { activa: true },
        select: { empleado_id: true },
      }),
    ]);

    const notifEmpIds = Array.from(
      new Set(ultimasNotificaciones.map((n) => n.empleado_id))
    );
    const empleadosMap = new Map<string, string>();
    if (notifEmpIds.length > 0) {
      const emps = await prisma.minuta_empleado.findMany({
        where: { id: { in: notifEmpIds } },
        select: { id: true, apellido_nombre: true },
      });
      for (const e of emps) {
        empleadosMap.set(e.id, e.apellido_nombre);
      }
    }

    const notificacionesEnriquecidas = ultimasNotificaciones.map((n) => ({
      ...n,
      empleado_nombre: empleadosMap.get(n.empleado_id) || null,
    }));

    const resumenEstadosNotificaciones: Record<string, number> = {};
    for (const row of resumenNotificaciones) {
      resumenEstadosNotificaciones[row.estado] = row._count._all;
    }

    const empleadosSuscritosUnicos = new Set(
      suscripcionesActivas.map((s) => s.empleado_id)
    ).size;

    return NextResponse.json({
      ahoraBogota: getBogotaNowParts(),
      vapidConfigurado: getVapidConfig().configured,
      scheduler: getSchedulerStatus(),
      suscripciones: {
        totalActivas: suscripcionesActivas.length,
        empleadosUnicosSuscritos: empleadosSuscritosUnicos,
      },
      resumenEstadosNotificaciones,
      diagnosticoHorarios: diagnostico,
      ultimasNotificaciones: notificacionesEnriquecidas,
      ultimosCierresAutomaticos: ultimosCierres,
    });
  } catch (error) {
    console.error("Error en GET /api/admin/horarios-diagnostico:", error);
    return NextResponse.json(
      { error: "Error generando diagnóstico de horarios." },
      { status: 500 }
    );
  }
}
