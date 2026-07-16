import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "next/navigation";
import { ExportSyncButton } from "@/components/ExportSyncButton";
import { CleanDatabaseButton } from "@/components/CleanDatabaseButton";
import { CalendarClock, FileSpreadsheet, FolderOpen } from "lucide-react";

function getCurrentYearRange() {
  const year = new Date().getFullYear();

  return {
    year,
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export default async function ExportarPage() {
  const session = await getServerSession(authOptions);
  const canExport = session?.user?.email?.toLowerCase() === "auditoriaycalidad@evoforma.net";

  if (!canExport) {
    redirect("/dashboard");
  }

  const { year, start, end } = getCurrentYearRange();
  const minutas = await prisma.minuta_registro_actividad.findMany({
    where: {
      fecha: {
        gte: start,
        lt: end,
      },
    },
    include: {
      minuta_empleado: true,
    },
  });
  const folderId = process.env.GOOGLE_DRIVE_EXPORT_FOLDER_ID ?? "1HTK2XHTteV5w-zgBYasP7vYfmQ5DCn7G";
  const isConfigured = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
  const grouped = Array.from(
    minutas.reduce((acc, minuta) => {
      const cargo = minuta.minuta_empleado.cargo?.trim() || "SIN CARGO";
      acc.set(cargo, (acc.get(cargo) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort(([cargoA], [cargoB]) => cargoA.localeCompare(cargoB, "es"));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="color-white">
          <h1 className="text-3xl font-bold tracking-tight">Exportar tiempos</h1>
          <p className="mt-1 text-brand-light/75">
            Crea y actualiza archivos de Google Sheets por cargo para el año {year}.
          </p>
        </div>
        <ExportSyncButton />
      </div>

      {!isConfigured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Faltan las variables GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY. Comparte la
          carpeta de Drive con esa cuenta de servicio antes de sincronizar.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 p-5 transition-all duration-200 hover:shadow-md hover:border-brand-primary/20">
          <div className="flex items-center gap-2 text-brand-dark/70">
            <CalendarClock className="h-5 w-5 text-brand-primary" />
            <span className="text-sm font-medium">Año</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-brand-dark">{year}</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 p-5 transition-all duration-200 hover:shadow-md hover:border-brand-primary/20">
          <div className="flex items-center gap-2 text-brand-dark/70">
            <FileSpreadsheet className="h-5 w-5 text-brand-primary" />
            <span className="text-sm font-medium">Registros</span>
          </div>
          <p className="mt-3 text-3xl font-bold text-brand-dark">{minutas.length}</p>
        </div>

        <a
          href={`https://drive.google.com/drive/folders/${folderId}`}
          target="_blank"
          rel="noreferrer"
          className="bg-white rounded-xl shadow-sm border border-brand-dark/10 p-5 transition-all duration-200 hover:shadow-md hover:border-brand-primary/30 hover:bg-brand-dark/5 block group"
        >
          <div className="flex items-center gap-2 text-brand-dark/70 group-hover:text-brand-primary transition-colors">
            <FolderOpen className="h-5 w-5 text-brand-primary" />
            <span className="text-sm font-medium">Carpeta destino</span>
          </div>
          <p className="mt-3 text-sm font-semibold text-brand-dark group-hover:underline">Abrir en Drive</p>
        </a>
      </div>

      <CleanDatabaseButton />

      <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden">
        <div className="p-6 border-b border-brand-dark/10">
          <h2 className="text-xl font-bold text-brand-dark">Archivos que se crearán o actualizarán</h2>
        </div>

        {grouped.length === 0 ? (
          <div className="p-8 text-center text-brand-dark/60">
            No hay tiempos registrados para {year}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-brand-dark/80">
              <thead className="bg-brand-dark/5 text-brand-dark">
                <tr>
                  <th className="px-4 py-3 font-semibold">Cargo</th>
                  <th className="px-4 py-3 font-semibold">Archivo</th>
                  <th className="px-4 py-3 text-right font-semibold">Registros</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-dark/10">
                {grouped.map(([cargo, total]) => (
                  <tr key={cargo} className="hover:bg-brand-dark/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-brand-dark">{cargo}</td>
                    <td className="px-4 py-3">Tiempos {year} - {cargo}</td>
                    <td className="px-4 py-3 text-right font-semibold">{total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
