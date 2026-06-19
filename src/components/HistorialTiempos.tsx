"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, Clock, XCircle, Search, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { formatTime24 } from "@/lib/formatTime";

interface TiempoRecord {
  id: number;
  empleado: string;
  fecha: Date | string;
  hora_inicio: Date | string;
  hora_fin: Date | string;
  actividad: string | null;
  proyecto: string | null;
  tipo_minuta: string;
  aprobado: string | null;
  minuta_proyecto?: {
    code: string;
    nombre: string;
  } | null;
  minuta_actividad?: {
    code: string;
    nombre: string;
    area: string | null;
    descripcion: string | null;
  } | null;
}

export function HistorialTiempos({ tiempos }: { tiempos: TiempoRecord[] }) {
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(false); // Default desc

  const getStatusIcon = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Horario Habitual" />;
    if (tipo === "B") {
      if (aprobado === "SI") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Aprobado" />;
      if (aprobado === "NO" || aprobado === "RE") return <XCircle className="h-5 w-5 text-red-500" aria-label="Rechazado" />;
      return <Clock className="h-5 w-5 text-amber-500" aria-label="Pendiente" />;
    }
    return null;
  };

  const getStatusBadge = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Regular</span>;
    if (tipo === "B") {
      if (aprobado === "SI") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Aprobado</span>;
      if (aprobado === "NO" || aprobado === "RE") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Rechazado</span>;
      return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Pendiente</span>;
    }
    return null;
  };

  // Filter records
  const filteredTiempos = tiempos.filter((t) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      (t.minuta_proyecto?.nombre?.toLowerCase().includes(searchLower) || false) ||
      (t.minuta_proyecto?.code?.toLowerCase().includes(searchLower) || false) ||
      (t.proyecto?.toLowerCase().includes(searchLower) || false) ||
      (t.minuta_actividad?.nombre?.toLowerCase().includes(searchLower) || false);

    const matchesTipo = tipoFilter ? t.tipo_minuta === tipoFilter : true;
    
    let matchesEstado = true;
    if (estadoFilter) {
      if (t.tipo_minuta === "A") {
        matchesEstado = estadoFilter === "SI"; // regular is approved/validated
      } else {
        matchesEstado = t.aprobado === estadoFilter;
      }
    }

    return matchesSearch && matchesTipo && matchesEstado;
  });

  // Sort records by date/start time
  const sortedTiempos = [...filteredTiempos].sort((a, b) => {
    const dateA = new Date(a.fecha).getTime();
    const dateB = new Date(b.fecha).getTime();
    
    if (dateA !== dateB) {
      return sortAsc ? dateA - dateB : dateB - dateA;
    }
    
    const startA = formatTime24(a.hora_inicio);
    const startB = formatTime24(b.hora_inicio);
    return sortAsc ? startA.localeCompare(startB) : startB.localeCompare(startA);
  });

  return (
    <div className="bg-white rounded-xl shadow-md border border-brand-dark/10 overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <div className="p-6 border-b border-brand-dark/10 bg-slate-50/50">
        <h2 className="text-xl font-bold text-brand-dark">Historial de Tiempos</h2>
        <p className="text-xs text-brand-dark/60 mt-1">Busca, filtra y consulta tus registros de tiempo.</p>
        
        {/* Barra de Filtros */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-brand-dark/40" />
            </span>
            <input
              type="text"
              placeholder="Buscar por proyecto o actividad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary"
            />
          </div>

          <div className="relative">
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
            >
              <option value="">Todos los tipos</option>
              <option value="A">Tipo A (Habitual)</option>
              <option value="B">Tipo B (Adicional)</option>
            </select>
          </div>

          <div className="relative">
            <select
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
            >
              <option value="">Todos los estados</option>
              <option value="SI">Aprobado / Regular</option>
              <option value="PE">Pendiente</option>
              <option value="RE">Rechazado</option>
            </select>
          </div>
        </div>
      </div>

      {sortedTiempos.length === 0 ? (
        <div className="p-10 text-center text-brand-dark/60">
          <SlidersHorizontal className="w-8 h-8 mx-auto text-brand-dark/30 mb-2" />
          <p className="font-medium text-sm">No se encontraron registros que coincidan con la búsqueda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-brand-dark/80">
            <thead className="bg-brand-dark/5 text-brand-dark border-b border-brand-dark/10">
              <tr>
                <th className="px-4 py-3 font-bold select-none cursor-pointer hover:bg-brand-dark/10 transition-colors" onClick={() => setSortAsc(!sortAsc)}>
                  <div className="flex items-center gap-1">
                    Fecha
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </div>
                </th>
                <th className="px-4 py-3 font-bold">Horario</th>
                <th className="px-4 py-3 font-bold">Cédula Proyecto</th>
                <th className="px-4 py-3 font-bold">Nombre del Proyecto</th>
                <th className="px-4 py-3 font-bold">Actividad</th>
                <th className="px-4 py-3 font-bold text-center">Tipo</th>
                <th className="px-4 py-3 font-bold text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-dark/10">
              {sortedTiempos.map((t) => (
                <tr key={t.id} className="hover:bg-brand-dark/5 transition-colors duration-150">
                  <td className="px-4 py-3 whitespace-nowrap font-medium">
                    {format(new Date(t.fecha), 'MMM dd, yyyy', { locale: es })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-brand-dark font-semibold">
                    {formatTime24(t.hora_inicio)} - {formatTime24(t.hora_fin)}
                  </td>
                  <td className="px-4 py-3 font-medium text-brand-dark/95 whitespace-nowrap">
                    {t.minuta_proyecto?.code || t.proyecto || '-'}
                  </td>
                  <td className="px-4 py-3 text-brand-dark/70 max-w-xs truncate" title={t.minuta_proyecto?.nombre || ""}>
                    {t.minuta_proyecto?.nombre || '-'}
                  </td>
                  <td className="px-4 py-3 text-brand-dark/80">
                    {t.minuta_actividad?.nombre || '-'}
                  </td>
                  <td className="px-4 py-3 text-center whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-bold rounded-md ${t.tipo_minuta === 'A' ? 'bg-brand-primary/10 text-brand-primary' : 'bg-brand-primary/10 text-brand-primary/90'}`}>
                      Tipo {t.tipo_minuta}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      {getStatusIcon(t.tipo_minuta, t.aprobado)}
                      {getStatusBadge(t.tipo_minuta, t.aprobado)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
