import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAuthorizedAuditor } from "@/app/actions/minuta";
import { getEmpleadoActivoPorId } from "@/lib/horarios";
import { enviarNotificacionPruebaUsuario } from "@/lib/pushNotifications";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/test
 * Envía una notificación Web Push de prueba desde el backend al empleado autenticado
 * (o a un empleado específico si el solicitante es administrador autorizado).
 */
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedEmpleadoId =
      typeof body?.empleadoId === "string" ? body.empleadoId.trim() : "";

    let targetEmpleadoId = session.user.id;
    if (requestedEmpleadoId && requestedEmpleadoId !== session.user.id) {
      if (!(await isAuthorizedAuditor(session))) {
        return NextResponse.json(
          { error: "Solo administradores pueden enviar pruebas a otros empleados." },
          { status: 403 }
        );
      }
      targetEmpleadoId = requestedEmpleadoId;
    }

    const empleado = await getEmpleadoActivoPorId(targetEmpleadoId);
    if (!empleado) {
      return NextResponse.json(
        { error: "El empleado no existe o no está activo (activo = 'SI')." },
        { status: 404 }
      );
    }

    const result = await enviarNotificacionPruebaUsuario(empleado.id);
    return NextResponse.json(
      {
        empleadoId: empleado.id,
        empleadoNombre: empleado.apellido_nombre,
        ...result,
      },
      { status: result.ok ? 200 : 400 }
    );
  } catch (error) {
    console.error("Error en POST /api/push/test:", error);
    return NextResponse.json(
      { error: "Error enviando notificación de prueba." },
      { status: 500 }
    );
  }
}
