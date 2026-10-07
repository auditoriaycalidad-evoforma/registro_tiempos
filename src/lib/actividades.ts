import prisma from "@/lib/prisma";

export interface ActividadItem {
  code: string;
  nombre: string;
  area: string | null;
  descripcion: string | null;
}

/**
 * Consulta la tabla minuta_actividad aplicando la regla de negocio universal:
 * - Actividades cuyo campo area coincida exactamente con el cargo/área del empleado (sin distinción de mayúsculas/minúsculas).
 * - Todas las actividades cuyo campo area sea "todas" (sin distinción de mayúsculas/minúsculas).
 */
export async function getActividadesParaEmpleado(cargo?: string | null): Promise<ActividadItem[]> {
  const trimmedCargo = cargo?.trim();

  if (!trimmedCargo) {
    return prisma.minuta_actividad.findMany({
      where: {
        area: {
          equals: "todas",
          mode: "insensitive",
        },
      },
      orderBy: { nombre: "asc" },
    });
  }

  return prisma.minuta_actividad.findMany({
    where: {
      OR: [
        {
          area: {
            equals: trimmedCargo,
            mode: "insensitive",
          },
        },
        {
          area: {
            equals: "todas",
            mode: "insensitive",
          },
        },
      ],
    },
    orderBy: { nombre: "asc" },
  });
}

/**
 * Filtro en memoria para componentes cliente (MinutaForm, HistorialTiempos, PwaContainer)
 */
export function filtrarActividadesPorCargo<T extends { area: string | null; code: string; nombre: string }>(
  actividades: T[],
  cargo?: string | null
): T[] {
  const trimmedCargo = cargo?.trim().toLowerCase();

  return actividades.filter((act) => {
    const actArea = act.area?.trim().toLowerCase();
    if (!actArea) return false;
    if (actArea === "todas") return true;
    if (trimmedCargo && actArea === trimmedCargo) return true;
    return false;
  });
}

/**
 * Obtiene el empleado autenticado y su cargo consultando la tabla minuta_empleado
 */
export async function getEmpleadoAutenticado(userId?: string | null, email?: string | null) {
  if (!userId && !email) return null;

  return prisma.minuta_empleado.findFirst({
    where: {
      OR: [
        ...(userId ? [{ id: userId }] : []),
        ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
      ],
    },
  });
}
