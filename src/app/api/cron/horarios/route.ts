import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAuthorizedAuditor } from "@/app/actions/minuta";
import { ejecutarCicloHorarios } from "@/lib/scheduler";

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

async function handleCron(request: Request) {
  if (!(await isAuthorizedCronRequest(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await ejecutarCicloHorarios({
      runPush: true,
      runAutoClose: true,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en /api/cron/horarios:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error ejecutando ciclo de horarios." },
      { status: 500 }
    );
  }
}

/**
 * GET / POST /api/cron/horarios
 * Permite disparar manualmente o desde un cron externo el ciclo completo de:
 *  - Notificaciones push (5 min antes de inicio/fin de jornada, America/Bogota)
 *  - Cierre automático de actividades abiertas + creación de Tipo O abierta
 */
export async function GET(request: Request) {
  return handleCron(request);
}

export async function POST(request: Request) {
  return handleCron(request);
}
