import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getEmpleadoActivoPorId } from "@/lib/horarios";

export const dynamic = "force-dynamic";

/**
 * GET /api/push/subscribe
 * Consulta si el empleado autenticado (por documento id) está activo ('SI') y tiene suscripciones activas.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const empleado = await getEmpleadoActivoPorId(session.user.id);
    if (!empleado) {
      return NextResponse.json({
        activo: false,
        subscribed: false,
        count: 0,
      });
    }

    const activeSubs = await prisma.minuta_push_suscripcion.findMany({
      where: {
        empleado_id: empleado.id,
        activa: true,
      },
      select: {
        id: true,
        endpoint: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      activo: true,
      subscribed: activeSubs.length > 0,
      count: activeSubs.length,
    });
  } catch (error) {
    console.error("Error en GET /api/push/subscribe:", error);
    return NextResponse.json(
      { error: "Error consultando estado de notificaciones." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/push/subscribe
 * Registra o reactiva una suscripción Web Push asociada estrictamente al documento (id) del empleado activo.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Validar estrictamente por documento y activo = 'SI'
    const empleado = await getEmpleadoActivoPorId(session.user.id);
    if (!empleado) {
      return NextResponse.json(
        { error: "Solo los empleados activos (activo = 'SI') pueden activar notificaciones push." },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
    }

    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh.trim() : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth.trim() : "";

    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json(
        { error: "Suscripción Web Push incompleta (endpoint, p256dh y auth son obligatorios)." },
        { status: 400 }
      );
    }

    if (!endpoint.startsWith("https://")) {
      return NextResponse.json(
        { error: "El endpoint de suscripción debe usar HTTPS." },
        { status: 400 }
      );
    }

    const userAgent = (request.headers.get("user-agent") || "").slice(0, 512) || null;
    const now = new Date();

    const saved = await prisma.minuta_push_suscripcion.upsert({
      where: { endpoint },
      create: {
        empleado_id: empleado.id,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent,
        activa: true,
        last_error: null,
        created_at: now,
        updated_at: now,
      },
      update: {
        empleado_id: empleado.id,
        p256dh,
        auth,
        user_agent: userAgent,
        activa: true,
        last_error: null,
        updated_at: now,
      },
      select: {
        id: true,
        empleado_id: true,
        activa: true,
      },
    });

    return NextResponse.json({
      success: true,
      subscription: saved,
    });
  } catch (error) {
    console.error("Error en POST /api/push/subscribe:", error);
    return NextResponse.json(
      { error: "Error guardando la suscripción push." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/push/subscribe
 * Desactiva la suscripción Web Push del dispositivo actual (o todas las del empleado autenticado).
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";

    if (endpoint) {
      await prisma.minuta_push_suscripcion.updateMany({
        where: {
          empleado_id: session.user.id,
          endpoint,
        },
        data: {
          activa: false,
          updated_at: new Date(),
        },
      });
    } else {
      await prisma.minuta_push_suscripcion.updateMany({
        where: {
          empleado_id: session.user.id,
        },
        data: {
          activa: false,
          updated_at: new Date(),
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error en DELETE /api/push/subscribe:", error);
    return NextResponse.json(
      { error: "Error desactivando suscripción push." },
      { status: 500 }
    );
  }
}
