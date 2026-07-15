"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { CheckCircle2, Clock, XCircle, Search, SlidersHorizontal, ArrowUpDown, Edit2, Save, X, AlertCircle } from "lucide-react";
import { formatTime24 } from "@/lib/formatTime";
import { useSession } from "next-auth/react";
import { updateMinutaHistory } from "@/app/actions/minuta";
import { useRouter } from "next/navigation";

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
  observacion?: string | null;
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
  minuta_empleado?: {
    id: string;
    apellido_nombre: string;
  } | null;
}

export function HistorialTiempos({ 
  tiempos, 
  proyectos = [], 
  actividades = [] 
}: { 
  tiempos: TiempoRecord[]; 
  proyectos?: any[]; 
  actividades?: any[]; 
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(false); // Default desc

  // Edit states
  const [editingRecord, setEditingRecord] = useState<TiempoRecord | null>(null);
  const [editForm, setEditForm] = useState({
    fecha: "",
    hora_inicio: "",
    hora_fin: "",
    proyecto: "",
    actividad: "",
    tipo_minuta: "",
    aprobado: "",
    observacion: ""
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sessionEmail = session?.user?.email?.toLowerCase();
  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const canEditHistory = sessionEmail && allowedEmails.includes(sessionEmail);

  const getStatusIcon = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Horario Habitual" />;
    if (tipo === "O") {
      if (aprobado === "SI") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Aprobado" />;
      if (aprobado === "NO" || aprobado === "RE") return <XCircle className="h-5 w-5 text-red-500" aria-label="Rechazado" />;
      return <Clock className="h-5 w-5 text-amber-500" aria-label="Pendiente" />;
    }
    return null;
  };

  const getStatusBadge = (tipo: string, aprobado: string | null) => {
    if (tipo === "A") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Regular</span>;
    if (tipo === "O") {
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
      (t.minuta_actividad?.nombre?.toLowerCase().includes(searchLower) || false) ||
      (t.minuta_empleado?.apellido_nombre?.toLowerCase().includes(searchLower) || false) ||
      (t.empleado?.toLowerCase().includes(searchLower) || false);

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

  // Edit methods
  const handleStartEdit = (t: TiempoRecord) => {
    const dateObj = new Date(t.fecha);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    setEditingRecord(t);
    setEditForm({
      fecha: dateStr,
      hora_inicio: formatTime24(t.hora_inicio),
      hora_fin: formatTime24(t.hora_fin),
      proyecto: t.proyecto || "",
      actividad: t.actividad || "",
      tipo_minuta: t.tipo_minuta,
      aprobado: t.aprobado || "SI",
      observacion: t.observacion || ""
    });
    setEditError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    setIsSaving(true);
    setEditError(null);

    const res = await updateMinutaHistory(editingRecord.id, editForm);
    if (res.error) {
      setEditError(res.error);
      setIsSaving(false);
    } else {
      setIsSaving(false);
      setEditingRecord(null);
      router.refresh();
    }
  };

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
              placeholder="Buscar por empleado, proyecto o actividad..."
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
              <option value="A">Tipo A</option>
              <option value="O">Tipo O</option>
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
                <th className="px-4 py-3 font-bold">Empleado</th>
                <th className="px-4 py-3 font-bold">Horario</th>
                <th className="px-4 py-3 font-bold">Cédula Proyecto</th>
                <th className="px-4 py-3 font-bold">Nombre del Proyecto</th>
                <th className="px-4 py-3 font-bold">Actividad</th>
                <th className="px-4 py-3 font-bold text-center">Tipo</th>
                <th className="px-4 py-3 font-bold text-center">Estado</th>
                {canEditHistory && <th className="px-4 py-3 font-bold text-center">Acción</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-dark/10">
              {sortedTiempos.map((t) => (
                <tr key={t.id} className="hover:bg-brand-dark/5 transition-colors duration-150">
                  <td className="px-4 py-3 whitespace-nowrap font-medium">
                    {format(new Date(t.fecha), 'MMM dd, yyyy', { locale: es })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-brand-dark/90 font-medium">
                    {t.minuta_empleado?.apellido_nombre || t.empleado}
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
                  {canEditHistory && (
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        onClick={() => handleStartEdit(t)}
                        className="p-1.5 rounded-lg text-brand-primary hover:bg-brand-primary/10 transition-colors"
                        title="Editar registro"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-brand-dark/10 overflow-hidden animate-scaleIn">
            {/* Header */}
            <div className="px-6 py-4 border-b border-brand-dark/10 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-brand-dark">Modificar Registro Histórico</h3>
                <p className="text-xs text-brand-dark/60 mt-0.5">Editando registro #{editingRecord.id} del empleado {editingRecord.minuta_empleado?.apellido_nombre || editingRecord.empleado}</p>
              </div>
              <button
                onClick={() => setEditingRecord(null)}
                className="text-brand-dark/40 hover:text-brand-dark hover:bg-brand-dark/5 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {editError && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-md text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{editError}</span>
              </div>
            )}

            {/* Form */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                {/* Fecha */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Fecha</label>
                  <input
                    type="date"
                    value={editForm.fecha}
                    onChange={(e) => setEditForm({ ...editForm, fecha: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary"
                  />
                </div>

                {/* Tipo de Horas */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Tipo de Horas</label>
                  <select
                    value={editForm.tipo_minuta}
                    onChange={(e) => setEditForm({ ...editForm, tipo_minuta: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
                  >
                    <option value="A">Tipo A</option>
                    <option value="O">Tipo O</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Hora Inicio */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Inicio (HH:MM)</label>
                  <input
                    type="text"
                    placeholder="HH:MM"
                    maxLength={5}
                    value={editForm.hora_inicio}
                    onChange={(e) => setEditForm({ ...editForm, hora_inicio: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary"
                  />
                </div>

                {/* Hora Fin */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Fin (HH:MM)</label>
                  <input
                    type="text"
                    placeholder="HH:MM"
                    maxLength={5}
                    value={editForm.hora_fin}
                    onChange={(e) => setEditForm({ ...editForm, hora_fin: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary"
                  />
                </div>
              </div>

              {/* Proyecto */}
              <div>
                <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Cédula del Proyecto</label>
                <select
                  value={editForm.proyecto}
                  onChange={(e) => setEditForm({ ...editForm, proyecto: e.target.value })}
                  className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
                >
                  {proyectos.map((p: any) => (
                    <option key={p.code} value={p.code}>
                      {p.code} - {p.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Actividad */}
              <div>
                <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Actividad</label>
                <select
                  value={editForm.actividad}
                  onChange={(e) => setEditForm({ ...editForm, actividad: e.target.value })}
                  className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
                >
                  {actividades.map((a: any) => (
                    <option key={a.code} value={a.code}>
                      {a.nombre} {a.area ? `(${a.area})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Estado */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Estado de Aprobación</label>
                  <select
                    value={editForm.aprobado}
                    onChange={(e) => setEditForm({ ...editForm, aprobado: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
                  >
                    <option value="SI">Aprobado / Regular</option>
                    <option value="PE">Pendiente</option>
                    <option value="RE">Rechazado</option>
                  </select>
                </div>
              </div>

              {/* Observación */}
              <div>
                <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Observación</label>
                <textarea
                  rows={2}
                  value={editForm.observacion}
                  onChange={(e) => setEditForm({ ...editForm, observacion: e.target.value })}
                  className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary"
                  placeholder="Detalles sobre este registro..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-brand-dark/10 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                disabled={isSaving}
                className="px-4 py-2 border border-brand-dark/25 hover:bg-slate-100 text-brand-dark text-sm font-semibold rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={isSaving}
                className="px-4 py-2 bg-brand-primary hover:bg-brand-primary/95 text-white text-sm font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {isSaving ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
