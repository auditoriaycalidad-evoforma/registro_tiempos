"use client";

import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Clock, CheckCircle2, XCircle, Search } from "lucide-react";
import { AdminActionButtons } from "@/components/AdminActionButtons";
import { formatTime24 } from "@/lib/formatTime";
import { cleanDatabaseRecords } from "@/app/actions/admin";

interface Empleado {
  id: string;
  apellido_nombre: string;
  cargo?: string | null;
}

interface Proyecto {
  code: string;
  nombre: string;
}

interface Actividad {
  code: string;
  nombre: string;
  area: string | null;
}

interface MinutaO {
  id: number;
  empleado: string;
  fecha: string; // Serialized Date
  hora_inicio: string; // Serialized Date
  hora_fin: string; // Serialized Date
  proyecto: string | null;
  actividad: string | null;
  aprobado: string | null;
  observacion: string | null;
  minuta_empleado: Empleado | null;
  minuta_proyecto: Proyecto | null;
  minuta_actividad: Actividad | null;
}

interface AprobacionesPanelProps {
  minutasO: MinutaO[];
  esLider: boolean;
  isAdmin: boolean;
  leaderAreas: string[];
  isSuperAdmin: boolean;
}

export function AprobacionesPanel({ minutasO, esLider, isAdmin, leaderAreas, isSuperAdmin }: AprobacionesPanelProps) {
  // --- States ---
  const [search, setSearch] = useState("");
  const [empleadoFilter, setEmpleadoFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [cargoFilter, setCargoFilter] = useState("");
  const [mesFilter, setMesFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // Only for processed

  // --- Database cleanup states ---
  const [cleanupDate, setCleanupDate] = useState(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}-01`;
  });
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleCleanup = async () => {
    if (!cleanupDate) {
      alert("Por favor, seleccione una fecha límite para la limpieza.");
      return;
    }

    const confirmMsg = `¿Está seguro de que desea eliminar permanentemente todos los registros anteriores al ${cleanupDate} de la aplicación?\n\nEsta acción no se puede deshacer localmente. La información permanecerá resguardada en Google Sheets.`;
    if (!window.confirm(confirmMsg)) return;

    setIsCleaning(true);
    setCleanupMessage(null);

    try {
      const res = await cleanDatabaseRecords(cleanupDate);
      setIsCleaning(false);

      if (res.error) {
        setCleanupMessage({ text: res.error, type: "error" });
      } else {
        setCleanupMessage({
          text: `Limpieza exitosa. Se eliminaron ${res.count} registros de la aplicación.`,
          type: "success",
        });
        window.location.reload();
      }
    } catch (err) {
      setIsCleaning(false);
      setCleanupMessage({ text: "Error de red al ejecutar la limpieza.", type: "error" });
    }
  };

  // --- Dynamic catalog calculations ---
  const uniqueEmpleados = useMemo(() => {
    const map = new Map<string, string>();
    minutasO.forEach((m) => {
      if (m.minuta_empleado) {
        map.set(m.empleado, m.minuta_empleado.apellido_nombre);
      } else {
        map.set(m.empleado, m.empleado);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [minutasO]);

  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    minutasO.forEach((m) => {
      const area = m.minuta_actividad?.area;
      if (area) set.add(area.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [minutasO]);

  const uniqueCargos = useMemo(() => {
    const set = new Set<string>();
    minutasO.forEach((m) => {
      const cargo = m.minuta_empleado?.cargo;
      if (cargo) set.add(cargo.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [minutasO]);

  const uniqueMeses = useMemo(() => {
    const set = new Set<string>(); // Format: YYYY-MM
    minutasO.forEach((m) => {
      try {
        const dateObj = new Date(m.fecha);
        const yyyy = dateObj.getUTCFullYear();
        const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
        set.add(`${yyyy}-${mm}`);
      } catch (e) {
        // Ignore date parsing issues
      }
    });
    return Array.from(set)
      .sort()
      .reverse()
      .map((ym) => {
        const [year, month] = ym.split("-");
        const date = new Date(parseInt(year), parseInt(month) - 1, 1);
        const name = format(date, "MMMM yyyy", { locale: es });
        return {
          value: ym,
          label: name.charAt(0).toUpperCase() + name.slice(1),
        };
      });
  }, [minutasO]);

  // --- Helper: normalize text comparison ---
  const normalizeString = (str: string) =>
    str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

  // --- Filter Logic ---
  const filteredMinutas = useMemo(() => {
    return minutasO.filter((m) => {
      // 1. Empleado Filter
      if (empleadoFilter && m.empleado !== empleadoFilter) return false;

      // 2. Area Filter
      if (areaFilter && m.minuta_actividad?.area?.trim() !== areaFilter) return false;

      // 3. Cargo Filter
      if (cargoFilter && m.minuta_empleado?.cargo?.trim() !== cargoFilter) return false;

      // 4. Mes Filter (Date format is YYYY-MM-DD or full ISO string)
      if (mesFilter) {
        try {
          const dateObj = new Date(m.fecha);
          const yyyy = dateObj.getUTCFullYear();
          const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
          const recordYM = `${yyyy}-${mm}`;
          if (recordYM !== mesFilter) return false;
        } catch (e) {
          return false;
        }
      }

      // 5. Search Filter (matches employee, cargo, area, project code/name, activity, observation)
      if (search) {
        const query = search.toLowerCase();
        const empName = m.minuta_empleado?.apellido_nombre?.toLowerCase() || "";
        const empCargo = m.minuta_empleado?.cargo?.toLowerCase() || "";
        const actArea = m.minuta_actividad?.area?.toLowerCase() || "";
        const projCode = m.minuta_proyecto?.code?.toLowerCase() || m.proyecto?.toLowerCase() || "";
        const projName = m.minuta_proyecto?.nombre?.toLowerCase() || "";
        const actName = m.minuta_actividad?.nombre?.toLowerCase() || "";
        const obs = m.observacion?.toLowerCase() || "";
        
        const matches = 
          empName.includes(query) ||
          empCargo.includes(query) ||
          actArea.includes(query) ||
          projCode.includes(query) ||
          projName.includes(query) ||
          actName.includes(query) ||
          obs.includes(query);
          
        if (!matches) return false;
      }

      return true;
    });
  }, [minutasO, empleadoFilter, areaFilter, cargoFilter, mesFilter, search]);

  // --- Segregate into Pending and Processed ---
  const pendientesRaw = useMemo(() => {
    return filteredMinutas.filter((m) => m.aprobado === "PE");
  }, [filteredMinutas]);

  const procesadasRaw = useMemo(() => {
    return filteredMinutas.filter((m) => {
      const isProcessed = m.aprobado === "SI" || m.aprobado === "RE";
      if (!isProcessed) return false;
      if (statusFilter && m.aprobado !== statusFilter) return false;
      return true;
    });
  }, [filteredMinutas, statusFilter]);

  // Leaders only see pending from their assigned areas
  const pendientesFiltradas = useMemo(() => {
    if (isAdmin) return pendientesRaw;
    if (!esLider) return [];
    
    return pendientesRaw.filter((m) => {
      const actArea = m.minuta_actividad?.area;
      if (!actArea) return false;
      return leaderAreas.some(la => normalizeString(la) === normalizeString(actArea));
    });
  }, [pendientesRaw, esLider, isAdmin, leaderAreas]);

  return (
    <div className="space-y-6">
      {/* Dynamic Filters Bar */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-dark/10">
        <h3 className="text-sm font-bold text-brand-dark/70 uppercase tracking-wider mb-4">Filtros de Búsqueda</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
          {/* Search bar */}
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-brand-dark/40" />
            </span>
            <input
              type="text"
              placeholder="Buscar por empleado, proyecto, área, cargo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white"
            />
          </div>

          {/* Empleado filter */}
          <div className="relative">
            <select
              value={empleadoFilter}
              onChange={(e) => setEmpleadoFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium text-brand-dark"
            >
              <option value="">Todos los empleados</option>
              {uniqueEmpleados.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Área filter */}
          <div className="relative">
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium text-brand-dark"
            >
              <option value="">Todas las áreas</option>
              {uniqueAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>

          {/* Cargo filter */}
          <div className="relative">
            <select
              value={cargoFilter}
              onChange={(e) => setCargoFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium text-brand-dark"
            >
              <option value="">Todos los cargos</option>
              {uniqueCargos.map((cargo) => (
                <option key={cargo} value={cargo}>
                  {cargo}
                </option>
              ))}
            </select>
          </div>

          {/* Mes filter */}
          <div className="relative">
            <select
              value={mesFilter}
              onChange={(e) => setMesFilter(e.target.value)}
              className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium text-brand-dark"
            >
              <option value="">Todos los meses</option>
              {uniqueMeses.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter (Only visible/applicable to administrators who see processed history) */}
          {isAdmin && (
            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium text-brand-dark"
              >
                <option value="">Todos los estados procesados</option>
                <option value="SI">Aprobados</option>
                <option value="RE">Rechazados</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Sección de Aprobaciones Pendientes */}
      {esLider && (
        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden">
          <div className="p-6 border-b border-brand-dark/10 bg-brand-accent/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Clock className="w-5 h-5 text-brand-primary mr-2" />
                <h2 className="text-lg font-bold text-brand-dark">Pendientes de Aprobación</h2>
              </div>
              <span className="bg-brand-primary/10 text-brand-primary text-xs font-bold px-2.5 py-1 rounded-full">
                {pendientesFiltradas.length} pendientes
              </span>
            </div>
          </div>

          {pendientesFiltradas.length === 0 ? (
            <div className="p-8 text-center text-brand-dark/60 text-sm">
              No hay tiempos O pendientes de aprobación que coincidan con los filtros.
            </div>
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
                      <td className="px-4 py-3 font-medium text-brand-dark">
                        <div>{m.minuta_empleado?.apellido_nombre || m.empleado}</div>
                        {m.minuta_empleado?.cargo && (
                          <div className="text-[10px] text-brand-dark/50 font-normal">{m.minuta_empleado.cargo}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{format(new Date(m.fecha), "MMM dd, yyyy", { locale: es })}</div>
                        <div className="text-xs text-brand-dark/60 mt-0.5">
                          {formatTime24(m.hora_inicio)} - {formatTime24(m.hora_fin)}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium">{m.minuta_proyecto?.code || m.proyecto || "-"}</td>
                      <td className="px-4 py-3 text-xs text-brand-dark/70 font-medium">{m.minuta_proyecto?.nombre || "-"}</td>
                      <td className="px-4 py-3">{m.minuta_actividad?.nombre || "-"}</td>
                      <td className="px-4 py-3 text-xs italic text-brand-dark/70 max-w-xs truncate" title={m.observacion || ""}>
                        {m.observacion || "-"}
                      </td>
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
        <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden">
          <div className="p-6 border-b border-brand-dark/10 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-brand-dark">Historial Procesado (Administrador)</h2>
              <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2.5 py-1 rounded-full">
                {procesadasRaw.length} procesados
              </span>
            </div>
          </div>
          {procesadasRaw.length === 0 ? (
            <div className="p-8 text-center text-brand-dark/60 text-sm">
              No hay registros procesados que coincidan con los filtros.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-left text-sm text-brand-dark/80">
                <thead className="bg-brand-dark/5 text-brand-dark sticky top-0 z-10">
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
                  {procesadasRaw.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2 font-medium">
                        <div>{m.minuta_empleado?.apellido_nombre || m.empleado}</div>
                        {m.minuta_empleado?.cargo && (
                          <div className="text-[10px] text-brand-dark/50 font-normal">{m.minuta_empleado.cargo}</div>
                        )}
                      </td>
                      <td className="px-4 py-2">{format(new Date(m.fecha), "dd/MM/yyyy")}</td>
                      <td className="px-4 py-2 text-xs truncate max-w-xs">{m.minuta_proyecto?.code || m.proyecto}</td>
                      <td className="px-4 py-2 text-xs truncate max-w-xs">{m.minuta_proyecto?.nombre || "-"}</td>
                      <td className="px-4 py-2 text-xs italic truncate max-w-xs" title={m.observacion || ""}>
                        {m.observacion || "-"}
                      </td>
                      <td className="px-4 py-2 text-center whitespace-nowrap">
                        {m.aprobado === "SI" ? (
                          <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-800">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Aprobado
                          </span>
                        ) : (
                          <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-800">
                            <XCircle className="w-3 h-3 mr-1" />
                            Rechazado
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sección Administrativa de Limpieza de Registros (Solo Super Admin) */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden mt-8">
          <div className="p-6 border-b border-red-100 bg-red-50/50 flex items-center justify-between">
            <div className="flex items-center">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 mr-2.5 animate-pulse"></span>
              <h2 className="text-lg font-bold text-red-800">Limpieza de Registros de la Aplicación</h2>
            </div>
            <span className="text-[10px] uppercase font-extrabold bg-red-100 text-red-800 px-2.5 py-0.5 rounded-full border border-red-200">
              Solo Administrador
            </span>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-brand-dark/80 leading-relaxed">
              Esta opción elimina de forma permanente los registros de la base de datos local de la aplicación.
              La información **ya sincronizada** permanecerá resguardada de forma indefinida en la hoja de cálculo de Google Sheets.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 pt-2">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-brand-dark/70 mb-1.5">
                  Eliminar registros anteriores a:
                </label>
                <input
                  type="date"
                  value={cleanupDate}
                  onChange={(e) => setCleanupDate(e.target.value)}
                  className="px-3 py-2 w-full text-sm rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 bg-white"
                />
              </div>
              <div>
                <button
                  type="button"
                  onClick={handleCleanup}
                  disabled={isCleaning}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-bold text-sm rounded-lg shadow-md hover:shadow-lg transition-all active:scale-[0.98] w-full sm:w-auto flex items-center justify-center gap-2"
                >
                  {isCleaning ? "Procesando Limpieza..." : "Ejecutar Limpieza"}
                </button>
              </div>
            </div>
            
            {cleanupMessage && (
              <div className={`p-4 rounded-lg text-xs font-bold leading-normal flex items-start gap-2.5 animate-fadeIn ${cleanupMessage.type === "success" ? "bg-green-50 border-l-4 border-green-500 text-green-700" : "bg-red-50 border-l-4 border-red-500 text-red-700"}`}>
                <span>{cleanupMessage.text}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
