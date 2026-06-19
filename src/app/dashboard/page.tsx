import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MinutaForm } from "@/components/MinutaForm";
import { HistorialTiempos } from "@/components/HistorialTiempos";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  type ProyectoOption = {
    code: string;
    nombre: string;
  };

  // Cargar catálogos
  const proyectos = await prisma.$queryRaw<ProyectoOption[]>`
    SELECT DISTINCT
      cedula AS code,
      nombre_proyecto AS nombre
    FROM briefing_2026
    WHERE cedula IS NOT NULL
    ORDER BY cedula ASC
  `;

  const actividades = await prisma.minuta_actividad.findMany({
    orderBy: { nombre: 'asc' }
  });

  // Cargar registro de tiempos del usuario logueado
  const minutas = await prisma.minuta_registro_actividad.findMany({
    where: { empleado: session.user.id },
    orderBy: [
      { fecha: 'desc' },
      { hora_inicio: 'desc' }
    ],
    include: {
      minuta_proyecto: true,
      minuta_actividad: true,
    }
  });

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div className="color-white">
          <h1 className="text-3xl font-bold tracking-tight">Mi Panel</h1>
          <p className="mt-1">Registra tu tiempo.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(30rem,0.95fr)_minmax(0,1.25fr)] gap-6 2xl:gap-8">
        <div className="w-full">
          <MinutaForm proyectos={proyectos} actividades={actividades} />
        </div>

        <div className="min-w-0">
          <HistorialTiempos tiempos={minutas} />
        </div>
      </div>
    </div>
  );
}
