import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PwaContainer } from "./PwaContainer";

export const metadata = {
  title: "Evoforma - Registro de Tiempos",
  description: "Registro rápido de tiempos de actividades (PWA)",
  manifest: "/manifest.json",
  appleWebAppCapable: "yes",
  appleWebAppStatusBarStyle: "default",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#E87C1E",
};

export default async function PwaPage() {
  const session = await getServerSession(authOptions);

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

  let initialHistory: any[] = [];
  
  if (session?.user?.id) {
    const rawHistory = await prisma.minuta_registro_actividad.findMany({
      where: {
        empleado: session.user.id,
      },
      orderBy: [
        { fecha: "desc" },
        { hora_inicio: "desc" },
      ],
      include: {
        minuta_proyecto: true,
        minuta_actividad: true,
      },
      take: 50,
    });

    // Parsear fechas para evitar problemas de serialización en componentes cliente
    initialHistory = rawHistory.map((item) => ({
      id: item.id,
      empleado: item.empleado,
      fecha: item.fecha.toISOString().split('T')[0],
      hora_inicio: item.hora_inicio.toISOString(),
      hora_fin: item.hora_fin.toISOString(),
      actividad: item.actividad,
      proyecto: item.proyecto,
      tipo_minuta: item.tipo_minuta,
      aprobado: item.aprobado,
      observacion: item.observacion,
      minuta_proyecto: item.minuta_proyecto ? {
        code: item.minuta_proyecto.code,
        nombre: item.minuta_proyecto.nombre
      } : null,
      minuta_actividad: item.minuta_actividad ? {
        code: item.minuta_actividad.code,
        nombre: item.minuta_actividad.nombre,
        area: item.minuta_actividad.area,
        descripcion: item.minuta_actividad.descripcion
      } : null
    }));
  }

  return (
    <PwaContainer
      proyectos={proyectos}
      actividades={actividades}
      initialHistory={initialHistory}
      session={session}
    />
  );
}
