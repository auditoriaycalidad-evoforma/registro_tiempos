import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAuthorizedAuditor } from "@/app/actions/minuta";
import { ejecutarSoloNotificacionesPush } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

async function isAuthorizedCronRequest(request: Request): Promise<boolean> {
  const configuredSecrets = [
    process.env.HORARIOS_CRON_SECRET,
    process.env.CRON_SECRET,
    process.env.EXPORT_CRON_SECRET,
  ]
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s));

  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (bearerToken && configuredSecrets.includes(bearerToken)) {
    return true;
  }

  const session = await getServerSession(authOptions);
  if (session?.user?.id && (await isAuthorizedAuditor(session))) {
    return true;
  }

  return false;
}

async function handlePushCron(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await ejecutarSoloNotificacionesPush();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en /api/cron/notificaciones:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error ejecutando el despacho de notificaciones push.",
      },
      { status: 500 }
    );
  }
}

/**
 * GET / POST /api/cron/notificaciones
 * Endpoint dedicado para disparar únicamente el envío de notificaciones push
 * (5 minutos antes de hora_inicio y hora_fin en America/Bogota).
 */
export async function GET(request: Request) {
  return handlePushCron(request);
}

export async function POST(request: Request) {
  return handlePushCron(request);
}
