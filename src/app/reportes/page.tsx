import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ReportesPanel } from "@/components/ReportesPanel";

export default async function ReportesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/dashboard");
  }

  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session.user.email?.toLowerCase();
  const showReportes = !!(userEmail && allowedEmails.includes(userEmail));

  if (!showReportes) {
    redirect("/dashboard");
  }

  // Fetch all minutas to build reports (both Type A and Type O)
  const minutas = await prisma.minuta_registro_actividad.findMany({
    orderBy: [
      { fecha: "asc" },
      { hora_inicio: "asc" },
    ],
    include: {
      minuta_empleado: true,
      minuta_proyecto: true,
      minuta_actividad: true,
    },
  });

  // Serialize records for Client Component consumption
  const serializedMinutas = minutas.map((m) => ({
    id: m.id,
    empleado: m.empleado,
    fecha: m.fecha.toISOString(),
    hora_inicio: m.hora_inicio.toISOString(),
    hora_fin: m.hora_fin.toISOString(),
    proyecto: m.proyecto,
    actividad: m.actividad,
    tipo_minuta: m.tipo_minuta,
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
    <div className="space-y-6">
      <div className="color-white">
        <h1 className="text-3xl font-bold tracking-tight">Reportes y Tablas Dinámicas</h1>
        <p className="mt-1 text-brand-light/75">
          Consulte la información acumulada de horas, clasificada por área, mes, empleado y tipo.
        </p>
      </div>

      <ReportesPanel minutas={serializedMinutas} />
    </div>
  );
}
