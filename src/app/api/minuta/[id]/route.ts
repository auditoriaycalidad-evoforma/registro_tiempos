import { NextResponse } from "next/server";
import { updateMinutaHistory } from "@/app/actions/minuta";
import { deleteMinutaPwa } from "@/app/actions/pwa";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID de registro inválido." }, { status: 400 });
    }

    const body = await request.json();
    const result = await updateMinutaHistory(id, body);

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en PUT /api/minuta/[id]:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al actualizar el registro." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseInt(params.id, 10);
    if (isNaN(id)) {
      return NextResponse.json({ error: "ID de registro inválido." }, { status: 400 });
    }

    const result = await deleteMinutaPwa(id);

    if (result?.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error en DELETE /api/minuta/[id]:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al eliminar el registro." },
      { status: 500 }
    );
  }
}
