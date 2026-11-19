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
 *  - Últimos registros de envíos push y cierres automáticos
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
      ultimosCierres,
      suscripcionesActivas,
    ] = await Promise.all([
      detectarInconsistenciasHorarios(),
      prisma.minuta_notificacion_log.findMany({
        orderBy: { created_at: "desc" },
        take: 50,
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
      diagnosticoHorarios: diagnostico,
      ultimasNotificaciones,
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
