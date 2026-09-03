import { NextResponse } from "next/server";
import { syncMinutasToSheets } from "@/app/actions/exportar";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await syncMinutasToSheets();
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en POST /api/exportar:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al sincronizar exportación con Google Sheets." },
      { status: 500 }
    );
  }
}
