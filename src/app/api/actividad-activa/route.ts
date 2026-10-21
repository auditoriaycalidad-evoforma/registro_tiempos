import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { isAuthorizedAuditor } from "@/app/actions/minuta";

export const dynamic = "force-dynamic";

/**
 * Convierte un registro de minuta_actividad_activa al formato DesktopActiveTask / ActiveTaskData para el cliente.
 */
function formatActiveTaskResponse(row: any) {
  if (!row) return null;
  return {
    proyecto: row.proyecto,
    actividad: row.actividad,
    horaInicio: row.hora_inicio,
    startTimeStamp: Number(row.start_timestamp),
    observacion: row.observacion || "",
    fecha: row.fecha,
    tipoMinuta: row.tipo_minuta || "P",
    ubicacion: row.ubicacion || undefined,
    empleado: row.empleado_id,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * GET /api/actividad-activa
 * Obtiene la actividad activa en curso del usuario autenticado (o la de un empleado consultado por auditor).
 */
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedEmpleado = searchParams.get("empleadoId");

    let targetEmpleadoId = session.user.id;
    if (requestedEmpleado && requestedEmpleado !== session.user.id) {
      const isAuditor = await isAuthorizedAuditor(session);
      if (isAuditor) {
        targetEmpleadoId = requestedEmpleado;
      }
    }

    const activeRow = await prisma.minuta_actividad_activa.findUnique({
      where: { empleado_id: targetEmpleadoId },
    });

    return NextResponse.json({
      activeTask: formatActiveTaskResponse(activeRow),
    });
  } catch (error) {
    console.error("Error en GET /api/actividad-activa:", error);
    return NextResponse.json(
      { error: "Error al consultar la actividad activa." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/actividad-activa
 * Crea o actualiza completamente la actividad activa para el usuario.
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const {
      proyecto,
      actividad,
      horaInicio,
      startTimeStamp,
      observacion,
      fecha,
      tipoMinuta,
      ubicacion,
      empleado,
    } = body;

    if (!proyecto || !actividad || !horaInicio || !fecha) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios para la actividad activa." },
        { status: 400 }
      );
    }

    let targetEmpleadoId = session.user.id;
    if (empleado && empleado !== session.user.id) {
      const isAuditor = await isAuthorizedAuditor(session);
      if (isAuditor) {
        targetEmpleadoId = empleado;
      }
    }

    const now = Date.now();
    const finalStartTimeStamp = BigInt(startTimeStamp || now);
    const finalUpdatedAt = BigInt(now);

    const saved = await prisma.minuta_actividad_activa.upsert({
      where: { empleado_id: targetEmpleadoId },
      create: {
        empleado_id: targetEmpleadoId,
        proyecto: String(proyecto).trim(),
        actividad: String(actividad).trim(),
        hora_inicio: String(horaInicio).trim(),
        start_timestamp: finalStartTimeStamp,
        observacion: observacion ? String(observacion).trim() : null,
        fecha: String(fecha).trim(),
        tipo_minuta: String(tipoMinuta || "P").trim(),
        ubicacion: ubicacion ? String(ubicacion).trim() : null,
        updated_at: finalUpdatedAt,
      },
      update: {
        proyecto: String(proyecto).trim(),
        actividad: String(actividad).trim(),
        hora_inicio: String(horaInicio).trim(),
        start_timestamp: finalStartTimeStamp,
        observacion: observacion ? String(observacion).trim() : null,
        fecha: String(fecha).trim(),
        tipo_minuta: String(tipoMinuta || "P").trim(),
        ubicacion: ubicacion ? String(ubicacion).trim() : null,
        updated_at: finalUpdatedAt,
      },
    });

    return NextResponse.json({
      success: true,
      activeTask: formatActiveTaskResponse(saved),
    });
  } catch (error) {
    console.error("Error en POST /api/actividad-activa:", error);
    return NextResponse.json(
      { error: "Error interno al guardar la actividad activa en el servidor." },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/actividad-activa
 * Actualiza la observación en tiempo real de la actividad activa sin reiniciar el temporizador.
 */
export async function PATCH(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const { observacion, empleado } = body;

    let targetEmpleadoId = session.user.id;
    if (empleado && empleado !== session.user.id) {
      const isAuditor = await isAuthorizedAuditor(session);
      if (isAuditor) {
        targetEmpleadoId = empleado;
      }
    }

    const now = BigInt(Date.now());
    const existing = await prisma.minuta_actividad_activa.findUnique({
      where: { empleado_id: targetEmpleadoId },
    });

    if (!existing) {
      return NextResponse.json({ success: false, activeTask: null });
    }

    const updated = await prisma.minuta_actividad_activa.update({
      where: { empleado_id: targetEmpleadoId },
      data: {
        observacion: observacion !== undefined ? String(observacion).trim() : existing.observacion,
        updated_at: now,
      },
    });

    return NextResponse.json({
      success: true,
      activeTask: formatActiveTaskResponse(updated),
    });
  } catch (error) {
    console.error("Error en PATCH /api/actividad-activa:", error);
    return NextResponse.json(
      { error: "Error al actualizar la observación de la actividad activa." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/actividad-activa
 * Elimina la actividad activa cuando el usuario pulsa explícitamente "Finalizar Actividad Actual".
 */
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedEmpleado = searchParams.get("empleadoId");

    let targetEmpleadoId = session.user.id;
    if (requestedEmpleado && requestedEmpleado !== session.user.id) {
      const isAuditor = await isAuthorizedAuditor(session);
      if (isAuditor) {
        targetEmpleadoId = requestedEmpleado;
      }
    }

    await prisma.minuta_actividad_activa.deleteMany({
      where: { empleado_id: targetEmpleadoId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error en DELETE /api/actividad-activa:", error);
    return NextResponse.json(
      { error: "Error al eliminar la actividad activa." },
      { status: 500 }
    );
  }
}
