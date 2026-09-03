import { NextResponse } from "next/server";
import { cleanDatabaseRecords } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const beforeDate = body?.beforeDate || undefined;

    const result = await cleanDatabaseRecords(beforeDate);

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en POST /api/admin/limpiar-db:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al limpiar los registros." },
      { status: 500 }
    );
  }
}
