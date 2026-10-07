import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { PwaContainer } from "./PwaContainer";

export const metadata = {
  title: "Evoforma - Registro de Actividades",
  description: "Registro rápido de actividades (PWA)",
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
      COALESCE(nombre_proyecto, cedula) AS nombre
    FROM briefing_2026
    WHERE cedula IS NOT NULL
    ORDER BY cedula ASC
  `;

  const actividades = await prisma.minuta_actividad.findMany({
    orderBy: { nombre: 'asc' }
  });

  let initialHistory: any[] = [];
  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const userEmail = session?.user?.email?.toLowerCase();
  const isAdmin = !!(userEmail && allowedEmails.includes(userEmail));

  const empleados = await prisma.minuta_empleado.findMany({
    where: {
      OR: [
        { activo: null },
        { activo: { not: "N" } }
      ]
    },
    orderBy: { apellido_nombre: "asc" },
    select: {
      id: true,
      apellido_nombre: true,
      cargo: true,
    }
  });
  
  if (session?.user?.id && isAdmin) {
    const rawHistory = await prisma.minuta_registro_actividad.findMany({
      orderBy: [
        { fecha: "desc" },
        { hora_inicio: "desc" },
      ],
      include: {
        minuta_proyecto: true,
        minuta_actividad: true,
        minuta_empleado: true,
      },
      take: 100,
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
      minuta_empleado: item.minuta_empleado ? {
        id: item.minuta_empleado.id,
        apellido_nombre: item.minuta_empleado.apellido_nombre,
        cargo: item.minuta_empleado.cargo,
      } : null,
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
      empleados={empleados}
      initialHistory={initialHistory}
      session={session}
    />
  );
}
