import { syncMinutasToSheets } from "@/app/actions/exportar";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cronSecret = process.env.EXPORT_CRON_SECRET;
  const requestSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || requestSecret !== cronSecret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await syncMinutasToSheets({ skipAuth: true });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error sincronizando exportación" },
      { status: 500 }
    );
  }
}
