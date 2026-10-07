"use client";

import { useState, useMemo } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { 
  CheckCircle2, Clock, XCircle, Search, SlidersHorizontal, 
  ArrowUpDown, Edit2, Save, X, AlertCircle, Trash2, Calendar, 
  RotateCcw, User, Briefcase, FileSpreadsheet, Layers
} from "lucide-react";
import { formatTime24, formatTime12 } from "@/lib/formatTime";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SearchableSelect } from "./SearchableSelect";
import { TimePicker12 } from "./TimePicker12";

const DAYS_OF_WEEK = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];
const MONTHS = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", 
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

const getUTCDayName = (dateInput: Date | string) => {
  const date = new Date(dateInput);
  return DAYS_OF_WEEK[date.getUTCDay()];
};

const getUTCMonthName = (dateInput: Date | string) => {
  const date = new Date(dateInput);
  return MONTHS[date.getUTCMonth()];
};

const getUTCDateString = (dateInput: Date | string) => {
  const date = new Date(dateInput);
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

const calculateHours = (startInput: Date | string, endInput: Date | string) => {
  const start = new Date(startInput);
  const end = new Date(endInput);
  const diff = end.getTime() - start.getTime();
  return Math.round((diff / 36e5) * 100) / 100;
};

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
    cargo?: string | null;
  } | null;
}

export function HistorialTiempos({ 
  tiempos, 
  proyectos = [], 
  actividades = [],
  empleados = []
}: { 
  tiempos: TiempoRecord[]; 
  proyectos?: any[]; 
  actividades?: any[]; 
  empleados?: { id: string; apellido_nombre: string; cargo?: string | null }[];
}) {
  const { data: session } = useSession();
  const router = useRouter();

  // Filter States
  const [search, setSearch] = useState("");
  const [mesFilter, setMesFilter] = useState(""); // "" = Todos, "0".."11" = Mes
  const [diaSemanaFilter, setDiaSemanaFilter] = useState(""); // "" = Todos, "1" = Lunes, etc.
  const [diaMesFilter, setDiaMesFilter] = useState(""); // "" = Todos, "1".."31" = Día del mes
  const [empleadoFilter, setEmpleadoFilter] = useState(""); // "" = Todos
  const [tipoFilter, setTipoFilter] = useState("");
  const [estadoFilter, setEstadoFilter] = useState("");
  const [cargoFilter, setCargoFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(false); // Default desc

  // Dynamic Options derived from data
  const cargosDisponibles = useMemo(() => {
    const set = new Set<string>();
    tiempos.forEach((t) => {
      const cargo = t.minuta_empleado?.cargo;
      if (cargo) {
        set.add(cargo.trim());
      }
    });
    return Array.from(set).sort();
  }, [tiempos]);

  const empleadosDisponibles = useMemo(() => {
    const map = new Map<string, string>();
    tiempos.forEach((t) => {
      const id = t.minuta_empleado?.id || t.empleado;
      const nombre = t.minuta_empleado?.apellido_nombre || t.empleado;
      if (id && nombre) {
        map.set(id, nombre);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [tiempos]);

  // Edit states
  const [editingRecord, setEditingRecord] = useState<TiempoRecord | null>(null);
  const [editForm, setEditForm] = useState({
    empleado: "",
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

  // Delete states
  const [deletingRecord, setDeletingRecord] = useState<TiempoRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const sessionEmail = session?.user?.email?.toLowerCase()?.trim();
  const allowedEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const isAdmin = session?.user?.rol === "ADMIN" || (sessionEmail ? allowedEmails.includes(sessionEmail) : false);
  const canEditHistory = isAdmin;

  const getStatusIcon = (tipo: string, aprobado: string | null) => {
    if (tipo === "P" || tipo === "A") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Tipo P" />;
    if (tipo === "O") {
      if (aprobado === "SI") return <CheckCircle2 className="h-5 w-5 text-green-500" aria-label="Aprobado" />;
      if (aprobado === "NO" || aprobado === "RE") return <XCircle className="h-5 w-5 text-red-500" aria-label="Rechazado" />;
      return <Clock className="h-5 w-5 text-amber-500" aria-label="Pendiente" />;
    }
    return null;
  };

  const getStatusBadge = (tipo: string, aprobado: string | null) => {
    if (tipo === "P" || tipo === "A") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Regular</span>;
    if (tipo === "O") {
      if (aprobado === "SI") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Aprobado</span>;
      if (aprobado === "NO" || aprobado === "RE") return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">Rechazado</span>;
      return <span className="px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 text-amber-800">Pendiente</span>;
    }
    return null;
  };

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count++;
    if (mesFilter !== "") count++;
    if (diaSemanaFilter !== "") count++;
    if (diaMesFilter !== "") count++;
    if (empleadoFilter !== "") count++;
    if (tipoFilter !== "") count++;
    if (estadoFilter !== "") count++;
    if (cargoFilter !== "") count++;
    return count;
  }, [search, mesFilter, diaSemanaFilter, diaMesFilter, empleadoFilter, tipoFilter, estadoFilter, cargoFilter]);

  const handleResetFilters = () => {
    setSearch("");
    setMesFilter("");
    setDiaSemanaFilter("");
    setDiaMesFilter("");
    setEmpleadoFilter("");
    setTipoFilter("");
    setEstadoFilter("");
    setCargoFilter("");
  };

  // Filter records with independent Month and Day filtering
  const filteredTiempos = useMemo(() => {
    return tiempos.filter((t) => {
      const dateObj = new Date(t.fecha);

      // Search matching
      const searchLower = search.toLowerCase().trim();
      const matchesSearch = !searchLower || (
        (t.minuta_proyecto?.nombre?.toLowerCase().includes(searchLower) || false) ||
        (t.minuta_proyecto?.code?.toLowerCase().includes(searchLower) || false) ||
        (t.proyecto?.toLowerCase().includes(searchLower) || false) ||
        (t.minuta_actividad?.nombre?.toLowerCase().includes(searchLower) || false) ||
        (t.minuta_actividad?.code?.toLowerCase().includes(searchLower) || false) ||
        (t.minuta_empleado?.apellido_nombre?.toLowerCase().includes(searchLower) || false) ||
        (t.empleado?.toLowerCase().includes(searchLower) || false) ||
        (t.observacion?.toLowerCase().includes(searchLower) || false)
      );

      // Month Filter (0 to 11) - Independent
      const matchesMes = mesFilter === "" || dateObj.getUTCMonth() === parseInt(mesFilter, 10);

      // Day of Week Filter (0 = Dom, 1 = Lun, 2 = Mar, ...) - Independent
      const matchesDiaSemana = diaSemanaFilter === "" || dateObj.getUTCDay() === parseInt(diaSemanaFilter, 10);

      // Day of Month Filter (1 to 31) - Independent
      const matchesDiaMes = diaMesFilter === "" || dateObj.getUTCDate() === parseInt(diaMesFilter, 10);

      // Employee Filter
      const matchesEmpleado = empleadoFilter === "" || (
        t.minuta_empleado?.id === empleadoFilter || t.empleado === empleadoFilter
      );

      // Type Filter
      const matchesTipo = tipoFilter === "" 
        ? true 
        : (tipoFilter === "P" ? (t.tipo_minuta === "P" || t.tipo_minuta === "A") : t.tipo_minuta === tipoFilter);

      // Status Filter
      let matchesEstado = true;
      if (estadoFilter !== "") {
        if (t.tipo_minuta === "P" || t.tipo_minuta === "A") {
          matchesEstado = estadoFilter === "SI";
        } else {
          matchesEstado = t.aprobado === estadoFilter;
        }
      }

      // Role / Cargo Filter
      const matchesCargo = cargoFilter === "" || t.minuta_empleado?.cargo?.trim() === cargoFilter;

      return matchesSearch && matchesMes && matchesDiaSemana && matchesDiaMes && matchesEmpleado && matchesTipo && matchesEstado && matchesCargo;
    });
  }, [tiempos, search, mesFilter, diaSemanaFilter, diaMesFilter, empleadoFilter, tipoFilter, estadoFilter, cargoFilter]);

  // Sort records by date/start time
  const sortedTiempos = useMemo(() => {
    return [...filteredTiempos].sort((a, b) => {
      const dateA = new Date(a.fecha).getTime();
      const dateB = new Date(b.fecha).getTime();
      
      if (dateA !== dateB) {
        return sortAsc ? dateA - dateB : dateB - dateA;
      }
      
      const startA = formatTime24(a.hora_inicio);
      const startB = formatTime24(b.hora_inicio);
      return sortAsc ? startA.localeCompare(startB) : startB.localeCompare(startA);
    });
  }, [filteredTiempos, sortAsc]);

  // Metrics summary
  const metrics = useMemo(() => {
    let totalHours = 0;
    let hoursP = 0;
    let hoursO = 0;

    for (const t of filteredTiempos) {
      const h = calculateHours(t.hora_inicio, t.hora_fin);
      totalHours += h;
      if (t.tipo_minuta === "O") {
        hoursO += h;
      } else {
        hoursP += h;
      }
    }

    return {
      totalRecords: filteredTiempos.length,
      allRecordsCount: tiempos.length,
      totalHours: Math.round(totalHours * 100) / 100,
      hoursP: Math.round(hoursP * 100) / 100,
      hoursO: Math.round(hoursO * 100) / 100,
    };
  }, [filteredTiempos, tiempos.length]);

  // Edit methods
  const handleStartEdit = (t: TiempoRecord) => {
    const dateObj = new Date(t.fecha);
    const yyyy = dateObj.getUTCFullYear();
    const mm = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    setEditingRecord(t);
    setEditForm({
      empleado: t.minuta_empleado?.id || t.empleado || "",
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

    const proyectoInfo = proyectos.find(p => p.code === editForm.proyecto);
    if (!proyectoInfo || !proyectoInfo.nombre) {
      setEditError(`El proyecto con cédula "${editForm.proyecto}" no es válido. Debe seleccionar un proyecto válido de la base de datos.`);
      return;
    }

    setIsSaving(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/minuta/${editingRecord.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        setEditError(data?.error || "Error al modificar el registro");
        setIsSaving(false);
      } else {
        setIsSaving(false);
        setEditingRecord(null);
        router.refresh();
      }
    } catch (err: any) {
      setEditError(err?.message || "Error de conexión al guardar los cambios");
      setIsSaving(false);
    }
  };

  const handleDeleteRecord = async () => {
    if (!deletingRecord) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/minuta/${deletingRecord.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        setDeleteError(data?.error || "Error al eliminar el registro");
        setIsDeleting(false);
      } else {
        setIsDeleting(false);
        setDeletingRecord(null);
        router.refresh();
      }
    } catch (err: any) {
      setDeleteError(err?.message || "Error de conexión al eliminar el registro");
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-md border border-brand-dark/10 overflow-hidden hover:shadow-lg transition-shadow duration-300 space-y-0">
      
      {/* 1. Header & Dynamic Filters Toolbar */}
      <div className="p-6 border-b border-brand-dark/10 bg-slate-50/70 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold text-brand-dark flex items-center gap-2">
              <Clock className="w-5 h-5 text-brand-primary" />
              Historial de Registros
            </h2>
            <p className="text-xs text-brand-dark/60 mt-0.5">
              Panel de control y filtros dinámicos independientes por mes, día, colaborador y tipo.
            </p>
          </div>

          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-all active:scale-95 self-start sm:self-auto shadow-xs"
            >
              <RotateCcw className="w-3.5 h-3.5 text-brand-primary" />
              <span>Limpiar Filtros ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        {/* 2. Barra de Filtros Avanzados */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-2.5">
          
          {/* Búsqueda General */}
          <div className="relative xl:col-span-2">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-brand-dark/40" />
            </span>
            <input
              type="text"
              placeholder="Buscar proyecto, actividad, notas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 pr-3 py-2 w-full text-xs font-medium rounded-xl border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs"
            />
          </div>

          {/* Filtro Dinámico de Mes (Independiente) */}
          <div className="relative">
            <select
              value={mesFilter}
              onChange={(e) => setMesFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                mesFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">📅 Todos los meses</option>
              {MONTHS.map((mesNombre, idx) => (
                <option key={mesNombre} value={String(idx)}>
                  {mesNombre.charAt(0) + mesNombre.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Dinámico de Día de la Semana (Independiente) */}
          <div className="relative">
            <select
              value={diaSemanaFilter}
              onChange={(e) => setDiaSemanaFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                diaSemanaFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">🗓️ Todos los días (Semana)</option>
              <option value="1">Lunes</option>
              <option value="2">Martes</option>
              <option value="3">Miércoles</option>
              <option value="4">Jueves</option>
              <option value="5">Viernes</option>
              <option value="6">Sábado</option>
              <option value="0">Domingo</option>
            </select>
          </div>

          {/* Filtro Dinámico de Día del Mes (1 a 31) (Independiente) */}
          <div className="relative">
            <select
              value={diaMesFilter}
              onChange={(e) => setDiaMesFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                diaMesFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">🔢 Día del mes (1-31)</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
                <option key={d} value={d}>
                  Día {d.padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Colaborador */}
          <div className="relative">
            <select
              value={empleadoFilter}
              onChange={(e) => setEmpleadoFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                empleadoFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">👤 Colaboradores</option>
              {empleadosDisponibles.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro por Tipo */}
          <div className="relative">
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                tipoFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">🏷️ Todos los tipos</option>
              <option value="P">Tipo P (Habitual)</option>
              <option value="O">Tipo O (Extra)</option>
            </select>
          </div>

          {/* Filtro por Estado */}
          <div className="relative">
            <select
              value={estadoFilter}
              onChange={(e) => setEstadoFilter(e.target.value)}
              className={`px-3 py-2 w-full text-xs font-semibold rounded-xl border focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white shadow-2xs ${
                estadoFilter !== "" ? "border-brand-primary text-brand-primary bg-orange-50/30" : "border-brand-dark/20 text-brand-dark"
              }`}
            >
              <option value="">⚡ Estados</option>
              <option value="SI">Aprobado / Regular</option>
              <option value="PE">Pendiente</option>
              <option value="RE">Rechazado</option>
            </select>
          </div>
        </div>

        {/* 3. Strip de Métricas y Resumen en Vivo */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs border-t border-brand-dark/10">
          <div className="flex flex-wrap items-center gap-4 text-slate-600 font-semibold">
            <span className="flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-brand-primary" />
              Mostrando: <strong className="text-slate-900 font-black">{metrics.totalRecords}</strong> de {metrics.allRecordsCount} registros
            </span>
            <span className="hidden sm:inline text-slate-300">•</span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-brand-primary" />
              Total Horas: <strong className="text-slate-900 font-black">{metrics.totalHours.toFixed(2)}h</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 font-bold text-[11px]">
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
              Tipo P: {metrics.hoursP.toFixed(2)}h
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
              Tipo O: {metrics.hoursO.toFixed(2)}h
            </span>
          </div>
        </div>
      </div>

      {/* 4. Tabla de Registros */}
      {sortedTiempos.length === 0 ? (
        <div className="p-12 text-center text-brand-dark/60 space-y-3">
          <SlidersHorizontal className="w-10 h-10 mx-auto text-brand-dark/30 animate-pulse" />
          <p className="font-extrabold text-sm text-slate-800">No se encontraron registros con los filtros seleccionados.</p>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Prueba a cambiar el mes, día o colaborador seleccionado, o restablece los filtros.
          </p>
          {activeFiltersCount > 0 && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-bold hover:bg-brand-primary/90 transition-all shadow-sm inline-flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restablecer todos los filtros
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto max-h-[720px] overflow-y-auto">
          <table className="w-full text-left text-sm text-brand-dark/80 table-auto">
            <thead className="bg-slate-100 text-brand-dark border-b border-brand-dark/10 sticky top-0 z-10 shadow-xs">
              <tr>
                <th className="px-3 py-3 w-24 text-xs font-bold uppercase tracking-wider whitespace-nowrap">Día</th>
                <th className="px-2.5 py-3 w-24 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Tipo</th>
                <th className="px-3 py-3 w-24 text-xs font-bold uppercase tracking-wider whitespace-nowrap">Mes</th>
                <th className="px-3 py-3 w-28 text-xs font-bold uppercase tracking-wider select-none cursor-pointer hover:bg-brand-dark/10 transition-colors whitespace-nowrap" onClick={() => setSortAsc(!sortAsc)}>
                  <div className="flex items-center gap-1">
                    Fecha
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="px-3 py-3 w-32 text-xs font-bold uppercase tracking-wider whitespace-nowrap">Cédula</th>
                <th className="px-4 py-3 min-w-[200px] text-xs font-bold uppercase tracking-wider">Nombre del Proyecto</th>
                <th className="px-2.5 py-3 w-20 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Inicio</th>
                <th className="px-2.5 py-3 w-20 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Fin</th>
                <th className="px-2.5 py-3 w-20 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Horas</th>
                <th className="px-4 py-3 min-w-[150px] text-xs font-bold uppercase tracking-wider whitespace-nowrap">Colaborador</th>
                <th className="px-4 py-3 min-w-[220px] text-xs font-bold uppercase tracking-wider">Actividad - Cargo</th>
                <th className="px-3 py-3 w-28 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Estado</th>
                <th className="px-4 py-3 min-w-[160px] text-xs font-bold uppercase tracking-wider">Observación</th>
                {canEditHistory && <th className="px-2.5 py-3 w-20 text-center text-xs font-bold uppercase tracking-wider whitespace-nowrap">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-dark/10 bg-white">
              {sortedTiempos.map((t) => {
                const actName = t.minuta_actividad?.nombre || t.actividad || "";
                const empCargo = t.minuta_empleado?.cargo || "";
                const actividadCargo = actName && empCargo ? `${actName} - ${empCargo}` : (actName || empCargo || "-");

                return (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors duration-150">
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-xs text-brand-dark/80">{getUTCDayName(t.fecha)}</td>
                    <td className="px-2.5 py-3 text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 text-xs font-extrabold rounded-md ${t.tipo_minuta === 'O' ? 'bg-amber-100 text-amber-800' : 'bg-brand-primary/10 text-brand-primary'}`}>
                        Tipo {t.tipo_minuta === 'A' ? 'P' : t.tipo_minuta}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-medium text-xs text-brand-dark/80">{getUTCMonthName(t.fecha)}</td>
                    <td className="px-3 py-3 whitespace-nowrap font-semibold text-xs text-brand-dark">{getUTCDateString(t.fecha)}</td>
                    <td className="px-3 py-3 font-mono font-semibold text-brand-dark text-xs whitespace-nowrap">
                      {t.minuta_proyecto?.code || t.proyecto || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-brand-dark font-medium leading-relaxed break-words" title={t.minuta_proyecto?.nombre || ""}>
                      {t.minuta_proyecto?.nombre || "-"}
                    </td>
                    <td className="px-2.5 py-3 whitespace-nowrap text-center text-brand-dark font-semibold font-mono text-xs">
                      {formatTime12(t.hora_inicio)}
                    </td>
                    <td className="px-2.5 py-3 whitespace-nowrap text-center text-brand-dark font-semibold font-mono text-xs">
                      {formatTime12(t.hora_fin)}
                    </td>
                    <td className="px-2.5 py-3 text-center font-bold text-brand-primary text-xs whitespace-nowrap">
                      {calculateHours(t.hora_inicio, t.hora_fin).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-brand-dark font-medium text-xs">
                      {t.minuta_empleado?.apellido_nombre || t.empleado}
                    </td>
                    <td className="px-4 py-3 text-xs text-brand-dark/90 leading-relaxed break-words" title={actividadCargo}>
                      {actividadCargo}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {getStatusIcon(t.tipo_minuta, t.aprobado)}
                        {getStatusBadge(t.tipo_minuta, t.aprobado)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs italic text-brand-dark/75 leading-relaxed break-words" title={t.observacion || ""}>
                      {t.observacion || "-"}
                    </td>
                    {canEditHistory && (
                      <td className="px-2.5 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleStartEdit(t)}
                            className="p-1.5 rounded-lg text-brand-primary hover:bg-brand-primary/10 transition-colors"
                            title="Editar registro"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => {
                              setDeletingRecord(t);
                              setDeleteError(null);
                            }}
                            className="p-1.5 rounded-lg text-red-600 hover:bg-red-50 hover:text-red-700 transition-colors"
                            title="Eliminar registro"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-brand-dark/10 overflow-hidden animate-scaleIn">
            {/* Header */}
            <div className="px-6 py-4 border-b border-brand-dark/10 bg-slate-50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-brand-dark">Modificar Registro Histórico</h3>
                <p className="text-xs text-brand-dark/60 mt-0.5">Editando registro #{editingRecord.id} del colaborador {editingRecord.minuta_empleado?.apellido_nombre || editingRecord.empleado}</p>
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
              {empleados.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Apellido - Nombre (Colaborador)</label>
                  <SearchableSelect
                    name="empleado"
                    value={editForm.empleado}
                    onChange={(val) => setEditForm({ ...editForm, empleado: val })}
                    options={empleados.map((emp: any) => ({
                      value: emp.id,
                      label: emp.apellido_nombre,
                      sublabel: emp.cargo ? `(${emp.cargo})` : undefined
                    }))}
                    placeholder="Seleccione un colaborador"
                    required
                  />
                </div>
              )}

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
                    value={editForm.tipo_minuta === "A" ? "P" : editForm.tipo_minuta}
                    onChange={(e) => setEditForm({ ...editForm, tipo_minuta: e.target.value })}
                    className="w-full rounded-lg border border-brand-dark/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
                  >
                    <option value="P">Tipo P</option>
                    <option value="O">Tipo O</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Hora Inicio */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Inicio (12h)</label>
                  <TimePicker12
                    value={editForm.hora_inicio}
                    onChange={(val) => setEditForm({ ...editForm, hora_inicio: val })}
                  />
                </div>

                {/* Hora Fin */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Fin (12h)</label>
                  <TimePicker12
                    value={editForm.hora_fin}
                    onChange={(val) => setEditForm({ ...editForm, hora_fin: val })}
                  />
                </div>
              </div>

              {/* Proyecto */}
              <div>
                <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Cédula del Proyecto</label>
                <SearchableSelect
                  name="proyecto"
                  value={editForm.proyecto}
                  onChange={(val) => setEditForm({ ...editForm, proyecto: val })}
                  options={proyectos.map((p: any) => ({
                    value: p.code,
                    label: p.code,
                    sublabel: p.nombre
                  }))}
                  placeholder="Seleccione o busque una cédula"
                  required
                />
              </div>

              {/* Actividad */}
              <div>
                <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Actividad</label>
                <SearchableSelect
                  name="actividad"
                  value={editForm.actividad}
                  onChange={(val) => setEditForm({ ...editForm, actividad: val })}
                  options={actividades.map((a: any) => ({
                    value: a.code,
                    label: a.nombre,
                    sublabel: a.area ? `(${a.area})` : undefined
                  }))}
                  placeholder="Seleccione o busque una actividad"
                  required
                />
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

      {/* 6. Delete Confirmation Modal */}
      {deletingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-brand-dark/10 overflow-hidden animate-scaleIn">
            {/* Header */}
            <div className="px-6 py-4 border-b border-brand-dark/10 bg-red-50/50 flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-900">Eliminar Registro</h3>
                  <p className="text-xs text-red-700/80">Esta acción no se puede deshacer.</p>
                </div>
              </div>
              <button
                onClick={() => setDeletingRecord(null)}
                disabled={isDeleting}
                className="text-brand-dark/40 hover:text-brand-dark hover:bg-brand-dark/5 p-1.5 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {deleteError && (
              <div className="mx-6 mt-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-md text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            {/* Body */}
            <div className="p-6 space-y-3">
              <p className="text-xs text-brand-dark/80">
                ¿Estás seguro de que deseas eliminar permanentemente este registro?
              </p>

              <div className="bg-slate-50 border border-brand-dark/10 rounded-xl p-3.5 space-y-1.5 text-xs text-brand-dark">
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Registro ID:</span>
                  <span className="font-mono font-bold">#{deletingRecord.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Colaborador:</span>
                  <span className="font-bold">{deletingRecord.minuta_empleado?.apellido_nombre || deletingRecord.empleado}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Fecha:</span>
                  <span className="font-semibold">{getUTCDateString(deletingRecord.fecha)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Horario:</span>
                  <span className="font-semibold font-mono">
                    {formatTime12(deletingRecord.hora_inicio)} - {formatTime12(deletingRecord.hora_fin)} ({calculateHours(deletingRecord.hora_inicio, deletingRecord.hora_fin).toFixed(2)}h)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Proyecto:</span>
                  <span className="font-medium max-w-[200px] truncate text-right">{deletingRecord.minuta_proyecto?.code || deletingRecord.proyecto || "-"} - {deletingRecord.minuta_proyecto?.nombre || ""}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Actividad:</span>
                  <span className="font-medium max-w-[200px] truncate text-right">{deletingRecord.minuta_actividad?.nombre || deletingRecord.actividad || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-dark/60 font-medium">Tipo:</span>
                  <span className="font-bold">Tipo {deletingRecord.tipo_minuta === 'A' ? 'P' : deletingRecord.tipo_minuta}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-brand-dark/10 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingRecord(null)}
                disabled={isDeleting}
                className="px-4 py-2 border border-brand-dark/25 hover:bg-slate-100 text-brand-dark text-sm font-semibold rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteRecord}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                {isDeleting ? "Eliminando..." : "Eliminar Registro"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
