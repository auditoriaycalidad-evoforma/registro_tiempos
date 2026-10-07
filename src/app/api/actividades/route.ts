import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getActividadesParaEmpleado, getEmpleadoAutenticado } from "@/lib/actividades";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado. Inicie sesión." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedEmpleadoId = searchParams.get("empleado")?.trim();
    const requestedCargo = searchParams.get("cargo")?.trim();

    let cargoToUse: string | null | undefined = null;

    if (requestedCargo) {
      cargoToUse = requestedCargo;
    } else if (requestedEmpleadoId) {
      const emp = await prisma.minuta_empleado.findUnique({
        where: { id: requestedEmpleadoId },
      });
      cargoToUse = emp?.cargo;
    } else {
      // Identificación automática del colaborador autenticado desde minuta_empleado
      const emp = await getEmpleadoAutenticado(session.user.id, session.user.email);
      cargoToUse = emp?.cargo;
    }

    const actividades = await getActividadesParaEmpleado(cargoToUse);

    return NextResponse.json({
      actividades,
      cargo: cargoToUse || "SIN CARGO",
      total: actividades.length,
    });
  } catch (error) {
    console.error("Error en GET /api/actividades:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al consultar las actividades." },
      { status: 500 }
    );
  }
}
