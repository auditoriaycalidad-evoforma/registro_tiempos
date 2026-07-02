import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MinutaForm } from "@/components/MinutaForm";
import { HistorialTiempos } from "@/components/HistorialTiempos";
import { Clock } from "lucide-react";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  const isAdmin = session.user.rol === "ADMIN" || session.user.email?.toLowerCase() === "auditoriaycalidad@evoforma.net";

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

  // Cargar empleado para validar si es líder
  const empleado = await prisma.minuta_empleado.findFirst({
    where: {
      OR: [
        { id: session.user.id },
        { email: { equals: session.user.email ?? "", mode: "insensitive" } }
      ]
    }
  });
  const esLiderN = empleado ? empleado.es_lider === "N" : session.user.rol === "EMPLEADO";

  // Cargar registro de tiempos
  // Si es administrador, carga todos los registros incluyendo al empleado
  // Si es empleado normal, no es necesario cargar registros ya que el historial solo es visible para el admin
  const minutas = isAdmin
    ? await prisma.minuta_registro_actividad.findMany({
        orderBy: [
          { fecha: 'desc' },
          { hora_inicio: 'desc' }
        ],
        include: {
          minuta_proyecto: true,
          minuta_actividad: true,
          minuta_empleado: true,
        }
      })
    : [];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div className="color-white">
          <h1 className="text-3xl font-bold tracking-tight">Mi Panel</h1>
          <p className="mt-1">
            {isAdmin ? "Consulta el historial de registros de tiempo." : "Registra tu tiempo."}
          </p>
        </div>
      </div>

      {isAdmin ? (
        <div className="w-full">
          <HistorialTiempos tiempos={minutas} />
        </div>
      ) : esLiderN ? (
        <div className="max-w-3xl mx-auto w-full">
          <MinutaForm proyectos={proyectos} actividades={actividades} />
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(30rem,0.95fr)_minmax(0,1.25fr)] gap-6 2xl:gap-8">
          <div className="w-full">
            <MinutaForm proyectos={proyectos} actividades={actividades} />
          </div>

          <div className="min-w-0">
            <div className="bg-white rounded-xl shadow-md border border-brand-dark/10 p-8 text-center text-brand-dark/60 h-full min-h-[300px] flex flex-col justify-center items-center">
              <Clock className="w-12 h-12 text-brand-primary/45 mb-4 animate-pulse" />
              <h3 className="text-lg font-bold text-brand-dark mb-1">Historial Privado</h3>
              <p className="text-sm max-w-sm">El historial de registros de tiempo es restringido y únicamente visible para la administración.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
