import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AprobacionesPanel } from "@/components/AprobacionesPanel";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/dashboard");
  }

  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session.user.email?.toLowerCase();
  const isAdmin = session.user.rol === "ADMIN" || !!(userEmail && allowedEmails.includes(userEmail));

  // Consultar minuta_empleado para saber si es líder
  const empleado = await prisma.minuta_empleado.findUnique({
    where: { id: session.user.id }
  });
  const esLider = empleado?.es_lider === "S";

  if (!esLider && !isAdmin) {
    redirect("/dashboard");
  }

  // Filtrar las minutas O pendientes y todo el historial
  const minutasO = await prisma.minuta_registro_actividad.findMany({
    where: { tipo_minuta: "O" },
    orderBy: [{ fecha: "desc" }, { hora_inicio: "desc" }],
    include: {
      minuta_empleado: true,
      minuta_proyecto: true,
      minuta_actividad: true,
    },
  });

  const leaderAreas = empleado?.area_lider || [];
  const isSuperAdmin = userEmail === "auditoriaycalidad@evoforma.net";

  // Serializar fechas a cadenas ISO para Next.js Client Component
  const serializedMinutasO = minutasO.map((m) => ({
    id: m.id,
    empleado: m.empleado,
    fecha: m.fecha.toISOString(),
    hora_inicio: m.hora_inicio.toISOString(),
    hora_fin: m.hora_fin.toISOString(),
    proyecto: m.proyecto,
    actividad: m.actividad,
    aprobado: m.aprobado,
    observacion: m.observacion,
    minuta_empleado: m.minuta_empleado
      ? {
          id: m.minuta_empleado.id,
          apellido_nombre: m.minuta_empleado.apellido_nombre,
          cargo: m.minuta_empleado.cargo,
        }
      : null,
    minuta_proyecto: m.minuta_proyecto
      ? {
          code: m.minuta_proyecto.code,
          nombre: m.minuta_proyecto.nombre,
        }
      : null,
    minuta_actividad: m.minuta_actividad
      ? {
          code: m.minuta_actividad.code,
          nombre: m.minuta_actividad.nombre,
          area: m.minuta_actividad.area,
        }
      : null,
  }));

  return (
    <div className="space-y-8">
      <div className="color-white">
        <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
        <p className="mt-1 text-brand-light/75">Gestión y Aprobación de Tiempos Tipo O</p>
      </div>

      <AprobacionesPanel
        minutasO={serializedMinutasO}
        esLider={esLider}
        isAdmin={isAdmin}
        leaderAreas={leaderAreas}
        isSuperAdmin={isSuperAdmin}
      />
    </div>
  );
}
