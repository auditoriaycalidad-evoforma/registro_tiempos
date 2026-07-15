import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AdminActionButtons } from "@/components/AdminActionButtons";
import { Clock, CheckCircle2, XCircle } from "lucide-react";
import { formatTime24 } from "@/lib/formatTime";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/dashboard");
  }

  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session.user.email?.toLowerCase();
  const isAdmin = userEmail && allowedEmails.includes(userEmail);

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
    orderBy: [{ fecha: "desc" }],
    include: {
      minuta_empleado: true,
      minuta_proyecto: true,
      minuta_actividad: true,
    },
  });

  // Una vez aprobado (SI) o rechazado (RE), desaparece de pendientes (PE)
  const pendientes = minutasO.filter((m) => m.aprobado === "PE");
  const procesadas = minutasO.filter((m) => m.aprobado === "SI" || m.aprobado === "RE");

  // Normalización de texto para comparar áreas sin problemas de acentos ni mayúsculas/minúsculas
  const normalizeString = (str: string) => 
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  const leaderAreas = empleado?.area_lider || [];

  // Los líderes solo ven pendientes de sus áreas asignadas. Admin ve todas.
  const pendientesFiltradas = isAdmin ? pendientes : pendientes.filter((m) => {
    const actArea = m.minuta_actividad?.area;
    if (!actArea) return false;
    return leaderAreas.some(la => normalizeString(la) === normalizeString(actArea));
  });

  return (
    <div className="space-y-8">
      <div className="color-white">
        <h1 className="text-3xl font-bold tracking-tight">Panel de Administración</h1>
        <p className="mt-1 text-brand-light/75">Gestión y Aprobación de Tiempos Tipo O</p>
      </div>

      {/* Sección de Aprobaciones Pendientes (Solo para Líderes) */}
      {esLider && (
        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden">
          <div className="p-6 border-b border-brand-dark/10 bg-brand-accent/10">
            <div className="flex items-center">
              <Clock className="w-5 h-5 text-brand-accent mr-2" />
              <h2 className="text-lg font-bold text-brand-dark">Pendientes de Aprobación ({pendientesFiltradas.length})</h2>
            </div>
          </div>

          {pendientesFiltradas.length === 0 ? (
            <div className="p-8 text-center text-brand-dark/60">No hay tiempos O pendientes de aprobación en este momento.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-brand-dark/80">
                <thead className="bg-brand-dark/5 text-brand-dark">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Empleado</th>
                    <th className="px-4 py-3 font-semibold">Fecha / Hora</th>
                    <th className="px-4 py-3 font-semibold">Cédula Proyecto</th>
                    <th className="px-4 py-3 font-semibold">Nombre Proyecto</th>
                    <th className="px-4 py-3 font-semibold">Actividad</th>
                    <th className="px-4 py-3 font-semibold">Observación</th>
                    <th className="px-4 py-3 font-semibold text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-dark/10">
                  {pendientesFiltradas.map((m) => (
                    <tr key={m.id} className="hover:bg-brand-accent/5 transition-colors">
                      <td className="px-4 py-3 font-medium text-brand-dark">{m.minuta_empleado?.apellido_nombre || m.empleado}</td>
                      <td className="px-4 py-3">
                         <div>{format(new Date(m.fecha), 'MMM dd, yyyy', { locale: es })}</div>
                         <div className="text-xs text-brand-dark/60 mt-0.5">{formatTime24(m.hora_inicio)} - {formatTime24(m.hora_fin)}</div>
                      </td>
                      <td className="px-4 py-3">{m.minuta_proyecto?.code || m.proyecto || '-'}</td>
                      <td className="px-4 py-3 text-xs text-brand-dark/70 font-medium">{m.minuta_proyecto?.nombre || '-'}</td>
                      <td className="px-4 py-3">{m.minuta_actividad?.nombre || '-'}</td>
                      <td className="px-4 py-3 text-xs italic text-brand-dark/70 max-w-xs truncate" title={m.observacion || ""}>{m.observacion || '-'}</td>
                      <td className="px-4 py-3 w-32">
                        <AdminActionButtons id={m.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Historial Procesado (Solo para Administrador) */}
      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden mt-8">
          <div className="p-6 border-b border-brand-dark/10 bg-slate-50/50">
            <h2 className="text-lg font-bold text-brand-dark">Historial Procesado (Administrador)</h2>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-left text-sm text-brand-dark/80">
              <thead className="bg-brand-dark/5 text-brand-dark sticky top-0">
                <tr>
                  <th className="px-4 py-3 font-semibold">Empleado</th>
                  <th className="px-4 py-3 font-semibold">Fecha</th>
                  <th className="px-4 py-3 font-semibold">Proyecto</th>
                  <th className="px-4 py-3 font-semibold">Nombre del Proyecto</th>
                  <th className="px-4 py-3 font-semibold">Observación</th>
                  <th className="px-4 py-3 font-semibold text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-dark/10">
                {procesadas.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-2">{m.minuta_empleado?.apellido_nombre}</td>
                    <td className="px-4 py-2">{format(new Date(m.fecha), 'dd/MM/yyyy')}</td>
                    <td className="px-4 py-2 text-xs truncate max-w-xs">{m.minuta_proyecto?.code || m.proyecto}</td>
                    <td className="px-4 py-2 text-xs truncate max-w-xs">{m.minuta_proyecto?.nombre || '-'}</td>
                    <td className="px-4 py-2 text-xs italic truncate max-w-xs" title={m.observacion || ""}>{m.observacion || '-'}</td>
                    <td className="px-4 py-2 text-center">
                      {m.aprobado === "SI" ? (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" />Aprobado</span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1" />Rechazado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
