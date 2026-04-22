import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { MinutaForm } from "@/components/MinutaForm";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) return null;

  // Cargar catálogos
  const proyectos = await prisma.minuta_proyecto.findMany({
    orderBy: { nombre: 'asc' }
  });

  const actividades = await prisma.minuta_actividad.findMany({
    orderBy: { nombre: 'asc' }
  });

  // Cargar registro de minutas del usuario logueado
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

  const getStatusIcon = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <CheckCircle2 className="h-5 w-5 text-green-500" title="Horario Habitual" />;
    if (tipo === "B") {
      if (aprobado === "SI") return <CheckCircle2 className="h-5 w-5 text-green-500" title="Aprobada" />;
      if (aprobado === "NO" || aprobado === "RE") return <XCircle className="h-5 w-5 text-red-500" title="Rechazada" />;
      return <Clock className="h-5 w-5 text-amber-500" title="Pendiente de Aprobación" />;
    }
    return null;
  };

  const getStatusBadge = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Regular</span>;
    if (tipo === "B") {
      if (aprobado === "SI") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Aprobada</span>;
      if (aprobado === "NO" || aprobado === "RE") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Rechazada</span>;
      return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Pendiente</span>;
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Mi Panel</h1>
          <p className="mt-1 text-gray-500">Registra y visualiza tus horas trabajadas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <MinutaForm proyectos={proyectos} actividades={actividades} />
        </div>

        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-800">Historial de Minutas</h2>
            </div>
            
            {minutas.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>No tienes actividades registradas aún.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Fecha</th>
                      <th className="px-4 py-3 font-semibold">Horario</th>
                      <th className="px-4 py-3 font-semibold">Cédula del Proyecto</th>
                      <th className="px-4 py-3 font-semibold">Actividad</th>
                      <th className="px-4 py-3 font-semibold text-center">Tipo</th>
                      <th className="px-4 py-3 font-semibold text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {minutas.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {format(new Date(m.fecha), 'MMM dd, yyyy', { locale: es })}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-900 font-medium">
                          {format(new Date(m.hora_inicio), 'HHmm')} - {format(new Date(m.hora_fin), 'HHmm')}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-800">
                          {m.minuta_proyecto?.code || m.proyecto || '-'}
                        </td>
                        <td className="px-4 py-3">
                          {m.minuta_actividad?.nombre || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 text-xs font-bold rounded-md ${m.tipo_minuta === 'A' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>
                            Tipo {m.tipo_minuta}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1.5">
                            {getStatusIcon(m.tipo_minuta, m.aprobado)}
                            {getStatusBadge(m.tipo_minuta, m.aprobado)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
