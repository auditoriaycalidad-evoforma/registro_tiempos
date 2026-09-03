import { NextResponse } from "next/server";
import { approveMinuta } from "@/app/actions/admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, decision } = body;

    if (!id || (decision !== "SI" && decision !== "RE")) {
      return NextResponse.json(
        { error: "Parámetros inválidos. Se requiere id y decision ('SI' o 'RE')." },
        { status: 400 }
      );
    }

    const result = await approveMinuta(Number(id), decision);

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en POST /api/minuta/aprobar:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al procesar la aprobación." },
      { status: 500 }
    );
  }
}
