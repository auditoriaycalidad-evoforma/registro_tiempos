"use client";

import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { BarChart, Grid, Sliders, Filter, ArrowRight, BookOpen, User, Calendar, CheckSquare, RefreshCw } from "lucide-react";
import { formatTime24 } from "@/lib/formatTime";

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

interface MinutaRecord {
  id: number;
  empleado: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  proyecto: string | null;
  actividad: string | null;
  tipo_minuta: string;
  aprobado: string | null;
  observacion: string | null;
  minuta_empleado: Empleado | null;
  minuta_proyecto: Proyecto | null;
  minuta_actividad: Actividad | null;
}

interface ReportesPanelProps {
  minutas: MinutaRecord[];
}

export function ReportesPanel({ minutas }: ReportesPanelProps) {
  // --- Grouping Options ---
  // Rows: area, empleado, mes, fecha, tipo
  const [rowGrouping, setRowGrouping] = useState<"area" | "empleado" | "mes" | "fecha" | "tipo">("area");
  // Columns: none, tipo, mes
  const [colGrouping, setColGrouping] = useState<"none" | "tipo" | "mes">("none");

  // --- Filter States ---
  const [empleadoFilter, setEmpleadoFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [mesFilter, setMesFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // --- Hover State for Tooltips ---
  const [hoveredBar, setHoveredBar] = useState<{ key: string; value: number; x: number; y: number } | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<{ label: string; value: number; percent: number } | null>(null);

  // --- Helpers for Calculations ---
  const calculateHours = (start: string, end: string): number => {
    try {
      const dateStart = new Date(start);
      const dateEnd = new Date(end);
      const diff = dateEnd.getTime() - dateStart.getTime();
      return Math.round((diff / 36e5) * 100) / 100;
    } catch (e) {
      return 0;
    }
  };

  const getMesLabel = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      // use UTC to prevent timezone offsets shifting the month
      const utcDate = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      const name = format(utcDate, "MMMM yyyy", { locale: es });
      return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (e) {
      return "Mes Desconocido";
    }
  };

  const getMesValue = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    } catch (e) {
      return "Desconocido";
    }
  };

  // --- Catalog Extractors ---
  const uniqueEmpleados = useMemo(() => {
    const map = new Map<string, string>();
    minutas.forEach((m) => {
      if (m.minuta_empleado) {
        map.set(m.empleado, m.minuta_empleado.apellido_nombre);
      } else {
        map.set(m.empleado, m.empleado);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a,b)=>a.name.localeCompare(b.name, "es"));
  }, [minutas]);

  const uniqueAreas = useMemo(() => {
    const set = new Set<string>();
    minutas.forEach((m) => {
      const area = m.minuta_actividad?.area;
      if (area) set.add(area.trim());
    });
    return Array.from(set).sort((a,b)=>a.localeCompare(b, "es"));
  }, [minutas]);

  const uniqueMeses = useMemo(() => {
    const set = new Set<string>();
    minutas.forEach((m) => {
      set.add(getMesValue(m.fecha));
    });
    return Array.from(set).sort().reverse().map(val => {
      const [year, month] = val.split("-");
      const label = format(new Date(parseInt(year), parseInt(month) - 1, 1), "MMMM yyyy", { locale: es });
      return { value: val, label: label.charAt(0).toUpperCase() + label.slice(1) };
    });
  }, [minutas]);

  // --- Filter Logic ---
  const filteredMinutas = useMemo(() => {
    return minutas.filter((m) => {
      if (empleadoFilter && m.empleado !== empleadoFilter) return false;
      if (areaFilter && m.minuta_actividad?.area?.trim() !== areaFilter) return false;
      if (mesFilter && getMesValue(m.fecha) !== mesFilter) return false;
      if (tipoFilter && m.tipo_minuta !== tipoFilter) return false;
      
      const recordDate = m.fecha.split("T")[0];
      if (startDate && recordDate < startDate) return false;
      if (endDate && recordDate > endDate) return false;

      return true;
    });
  }, [minutas, empleadoFilter, areaFilter, mesFilter, tipoFilter, startDate, endDate]);

  // --- Pivot Matrix Data Generation ---
  const pivotData = useMemo(() => {
    const getRowGroupKey = (m: MinutaRecord): string => {
      switch (rowGrouping) {
        case "area": return m.minuta_actividad?.area || "SIN ÁREA";
        case "empleado": return m.minuta_empleado?.apellido_nombre || m.empleado;
        case "mes": return getMesLabel(m.fecha);
        case "fecha": return m.fecha.split("T")[0];
        case "tipo": return m.tipo_minuta === "A" ? "Tipo A (Habitual)" : "Tipo O (Extra)";
        default: return "Total";
      }
    };

    const getColGroupKey = (m: MinutaRecord): string => {
      switch (colGrouping) {
        case "tipo": return m.tipo_minuta === "A" ? "Tipo A" : "Tipo O";
        case "mes": return getMesLabel(m.fecha);
        default: return "Total Horas";
      }
    };

    const rowKeysSet = new Set<string>();
    const colKeysSet = new Set<string>();
    const cells = new Map<string, Map<string, number>>();
    const counts = new Map<string, Map<string, number>>();

    filteredMinutas.forEach((m) => {
      const rowKey = getRowGroupKey(m);
      const colKey = getColGroupKey(m);
      const hours = calculateHours(m.hora_inicio, m.hora_fin);

      rowKeysSet.add(rowKey);
      colKeysSet.add(colKey);

      if (!cells.has(rowKey)) {
        cells.set(rowKey, new Map<string, number>());
      }
      const rowCells = cells.get(rowKey)!;
      rowCells.set(colKey, (rowCells.get(colKey) ?? 0) + hours);

      if (!counts.has(rowKey)) {
        counts.set(rowKey, new Map<string, number>());
      }
      const rowCounts = counts.get(rowKey)!;
      rowCounts.set(colKey, (rowCounts.get(colKey) ?? 0) + 1);
    });

    const sortedRows = Array.from(rowKeysSet).sort((a, b) => a.localeCompare(b, "es"));
    const sortedCols = Array.from(colKeysSet).sort((a, b) => a.localeCompare(b, "es"));

    // Calculate Grand Totals
    const colTotals = new Map<string, number>();
    const colCounts = new Map<string, number>();
    let grandTotalHours = 0;
    let grandTotalRecords = 0;

    sortedRows.forEach((rKey) => {
      sortedCols.forEach((cKey) => {
        const hours = cells.get(rKey)?.get(cKey) ?? 0;
        const count = counts.get(rKey)?.get(cKey) ?? 0;

        colTotals.set(cKey, (colTotals.get(cKey) ?? 0) + hours);
        colCounts.set(cKey, (colCounts.get(cKey) ?? 0) + count);

        grandTotalHours += hours;
        grandTotalRecords += count;
      });
    });

    return {
      rows: sortedRows,
      cols: sortedCols,
      cells,
      counts,
      colTotals,
      colCounts,
      grandTotalHours,
      grandTotalRecords,
    };
  }, [filteredMinutas, rowGrouping, colGrouping]);

  // --- SVG Charts Calculations ---

  // 1. Data for Bar Chart: sum of hours per row key
  const barChartData = useMemo(() => {
    return pivotData.rows.map((rKey) => {
      let sum = 0;
      pivotData.cols.forEach((cKey) => {
        sum += pivotData.cells.get(rKey)?.get(cKey) ?? 0;
      });
      return {
        key: rKey,
        value: Math.round(sum * 100) / 100,
      };
    });
  }, [pivotData]);

  const maxBarValue = useMemo(() => {
    const max = Math.max(...barChartData.map((d) => d.value), 0);
    return max > 0 ? max : 1;
  }, [barChartData]);

  // 2. Data for Donut Chart: distribution by Area or by Time Type
  const donutChartData = useMemo(() => {
    const map = new Map<string, number>();
    filteredMinutas.forEach((m) => {
      const key = rowGrouping === "tipo" 
        ? (m.tipo_minuta === "A" ? "Tipo A" : "Tipo O")
        : (m.minuta_actividad?.area || "SIN ÁREA");
      const hours = calculateHours(m.hora_inicio, m.hora_fin);
      map.set(key, (map.get(key) ?? 0) + hours);
    });

    const total = Array.from(map.values()).reduce((a, b) => a + b, 0);

    return Array.from(map.entries())
      .map(([label, value]) => ({
        label,
        value: Math.round(value * 100) / 100,
        percent: total > 0 ? value / total : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [filteredMinutas, rowGrouping]);

  // SVG coordinates converter for Donut chart slices
  const getCoordinatesForPercent = (percent: number) => {
    const angle = 2 * Math.PI * (percent - 0.25); // Start at 12 o'clock (90 deg counter-clockwise)
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    return [x, y];
  };

  const getSlicePath = (startPercent: number, endPercent: number, radius: number = 80) => {
    if (endPercent - startPercent >= 0.999) {
      // Draw complete circle if single slice
      return `M 0 ${-radius} A ${radius} ${radius} 0 1 1 -0.01 ${-radius} Z`;
    }
    const [startX, startY] = getCoordinatesForPercent(startPercent);
    const [endX, endY] = getCoordinatesForPercent(endPercent);
    const largeArcFlag = endPercent - startPercent > 0.5 ? 1 : 0;
    return [
      `M ${startX * radius} ${startY * radius}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX * radius} ${endY * radius}`,
      `L 0 0`,
      `Z`,
    ].join(" ");
  };

  const CHART_COLORS = [
    "#E87C1E", // orange (brand primary)
    "#7A969B", // teal (brand secundary)
    "#4F46E5", // indigo
    "#10B981", // emerald
    "#EC4899", // pink
    "#F59E0B", // amber
    "#8B5CF6", // violet
    "#EF4444", // red
  ];

  const resetFilters = () => {
    setEmpleadoFilter("");
    setAreaFilter("");
    setMesFilter("");
    setTipoFilter("");
    setStartDate("");
    setEndDate("");
  };

  return (
    <div className="space-y-6">
      {/* 1. FILTER CONTROLLER SECTION */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-dark/10">
        <div className="flex items-center justify-between border-b border-brand-dark/10 pb-3 mb-5">
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-brand-primary" />
            <h2 className="text-lg font-bold text-brand-dark">Filtros de Reporte</h2>
          </div>
          <button
            onClick={resetFilters}
            className="text-xs font-bold text-brand-primary hover:text-brand-primary/80 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Limpiar Filtros
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Empleado */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Empleado</label>
            <select
              value={empleadoFilter}
              onChange={(e) => setEmpleadoFilter(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            >
              <option value="">Todos</option>
              {uniqueEmpleados.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          {/* Área */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Área</label>
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            >
              <option value="">Todas</option>
              {uniqueAreas.map((area) => (
                <option key={area} value={area}>
                  {area}
                </option>
              ))}
            </select>
          </div>

          {/* Mes */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Mes</label>
            <select
              value={mesFilter}
              onChange={(e) => setMesFilter(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            >
              <option value="">Todos</option>
              {uniqueMeses.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Tipo de Tiempo */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Tipo de Tiempo</label>
            <select
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            >
              <option value="">Todos</option>
              <option value="A">Tipo A (Habitual)</option>
              <option value="O">Tipo O (Extra)</option>
            </select>
          </div>

          {/* Fecha Inicio */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Desde</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            />
          </div>

          {/* Fecha Fin */}
          <div>
            <label className="block text-xs font-bold text-brand-dark/80 uppercase mb-1.5">Hasta</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 w-full text-xs rounded-lg border border-brand-dark/20 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary bg-white font-medium"
            />
          </div>
        </div>
      </div>

      {/* 2. GROUPING CONTROLLERS SECTION */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-dark/10">
        <div className="flex items-center gap-2 border-b border-brand-dark/10 pb-3 mb-5">
          <Sliders className="w-5 h-5 text-brand-primary" />
          <h2 className="text-lg font-bold text-brand-dark">Configuración de Tabla Dinámica</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-bold text-brand-dark/85 uppercase mb-2">Agrupar Filas Por</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "area", label: "Área" },
                { value: "empleado", label: "Empleado" },
                { value: "mes", label: "Mes" },
                { value: "fecha", label: "Fecha" },
                { value: "tipo", label: "Tipo de tiempo" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRowGrouping(opt.value as any)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                    rowGrouping === opt.value
                      ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                      : "bg-slate-50 border-brand-dark/15 text-brand-dark/80 hover:bg-slate-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-brand-dark/85 uppercase mb-2">Agrupar Columnas Por</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "none", label: "Ninguno (Totales)" },
                { value: "tipo", label: "Tipo de Tiempo" },
                { value: "mes", label: "Mes" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColGrouping(opt.value as any)}
                  className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all ${
                    colGrouping === opt.value
                      ? "bg-brand-primary text-white border-brand-primary shadow-sm"
                      : "bg-slate-50 border-brand-dark/15 text-brand-dark/80 hover:bg-slate-100"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. CHARTS GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-dark/10 lg:col-span-2 relative">
          <h3 className="text-sm font-bold text-brand-dark/80 uppercase tracking-wider mb-4 flex items-center gap-1.5">
            <BarChart className="w-4 h-4 text-brand-primary" />
            Horas Totales Agrupadas
          </h3>
          {barChartData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-slate-400">Sin datos de reporte.</div>
          ) : (
            <div className="relative h-72 w-full pt-4">
              <svg className="w-full h-full" viewBox="0 0 500 240" preserveAspectRatio="none">
                {/* Horizontal grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => (
                  <line
                    key={idx}
                    x1="40"
                    y1={200 - pct * 180}
                    x2="490"
                    y2={200 - pct * 180}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                ))}

                {/* Y-axis Labels */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => (
                  <text
                    key={idx}
                    x="32"
                    y={204 - pct * 180}
                    fill="#94A3B8"
                    fontSize="8"
                    fontWeight="bold"
                    textAnchor="end"
                  >
                    {Math.round(pct * maxBarValue)}h
                  </text>
                ))}

                {/* Vertical Bars */}
                {barChartData.map((d, idx) => {
                  const padding = 15;
                  const barAreaWidth = (450 - padding * 2) / barChartData.length;
                  const barWidth = Math.max(barAreaWidth * 0.6, 6);
                  const x = 40 + padding + idx * barAreaWidth + (barAreaWidth - barWidth) / 2;
                  
                  const barHeight = (d.value / maxBarValue) * 180;
                  const y = 200 - barHeight;

                  return (
                    <rect
                      key={d.key}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(barHeight, 1.5)}
                      fill="#E87C1E"
                      rx="3"
                      className="transition-all duration-300 hover:fill-brand-primary/80 cursor-pointer"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHoveredBar({
                          key: d.key,
                          value: d.value,
                          x: rect.left + rect.width / 2,
                          y: rect.top - 10,
                        });
                      }}
                      onMouseLeave={() => setHoveredBar(null)}
                    />
                  );
                })}
              </svg>

              {/* X Axis Labels under SVG */}
              <div className="flex justify-between pl-10 pr-2 pt-2 border-t border-slate-100">
                {barChartData.map((d) => (
                  <div
                    key={d.key}
                    className="text-[9px] font-bold text-slate-400 truncate text-center"
                    style={{ width: `${100 / barChartData.length}%` }}
                    title={d.key}
                  >
                    {d.key.length > 12 ? `${d.key.slice(0, 10)}...` : d.key}
                  </div>
                ))}
              </div>

              {/* Bar Tooltip overlay */}
              {hoveredBar && (
                <div
                  className="fixed bg-slate-900/95 text-white text-[10px] font-extrabold px-2.5 py-1.5 rounded-lg shadow-xl border border-slate-800 z-50 pointer-events-none transform -translate-x-1/2 -translate-y-full flex flex-col items-center gap-0.5 animate-fadeIn"
                  style={{ left: hoveredBar.x, top: hoveredBar.y }}
                >
                  <span className="text-slate-400 uppercase text-[8px] font-bold tracking-wider">{hoveredBar.key}</span>
                  <span>{hoveredBar.value.toFixed(1)} hrs</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Donut Chart Card */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-brand-dark/10 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-brand-dark/80 uppercase tracking-wider mb-4 flex items-center gap-1.5">
              <Grid className="w-4 h-4 text-brand-primary" />
              Distribución Horas
            </h3>
            {donutChartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-slate-400">Sin datos.</div>
            ) : (
              <div className="flex flex-col items-center justify-center py-2">
                <div className="relative w-44 h-44 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="-100 -100 200 200">
                    {/* Pie slices */}
                    {(() => {
                      let accumulatedPercent = 0;
                      return donutChartData.map((slice, idx) => {
                        const start = accumulatedPercent;
                        const end = accumulatedPercent + slice.percent;
                        accumulatedPercent = end;

                        const color = CHART_COLORS[idx % CHART_COLORS.length];

                        return (
                          <path
                            key={slice.label}
                            d={getSlicePath(start, end, 85)}
                            fill={color}
                            className="transition-all duration-300 hover:opacity-90 cursor-pointer"
                            onMouseEnter={() => {
                              setHoveredSlice({
                                label: slice.label,
                                value: slice.value,
                                percent: slice.percent,
                              });
                            }}
                            onMouseLeave={() => setHoveredSlice(null)}
                          />
                        );
                      });
                    })()}

                    {/* Donut hole to complete look */}
                    <circle cx="0" cy="0" r="50" fill="white" />
                  </svg>

                  {/* Centered slice text display */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 pointer-events-none">
                    {hoveredSlice ? (
                      <>
                        <span className="text-[9px] uppercase font-bold text-slate-400 truncate max-w-full">
                          {hoveredSlice.label}
                        </span>
                        <span className="text-sm font-black text-slate-800 leading-none mt-0.5">
                          {hoveredSlice.value.toFixed(1)}h
                        </span>
                        <span className="text-[10px] font-bold text-brand-primary mt-0.5">
                          {(hoveredSlice.percent * 100).toFixed(0)}%
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-[8px] uppercase font-bold text-slate-400">TOTAL</span>
                        <span className="text-base font-black text-slate-800 leading-none mt-0.5">
                          {pivotData.grandTotalHours.toFixed(1)}h
                        </span>
                        <span className="text-[9px] font-bold text-slate-400 mt-1">
                          {pivotData.grandTotalRecords} reg.
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Donut Legend */}
          <div className="space-y-1.5 mt-4 max-h-24 overflow-y-auto pr-1">
            {donutChartData.slice(0, 5).map((slice, idx) => (
              <div key={slice.label} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                  />
                  <span className="font-semibold text-brand-dark/80 truncate">{slice.label}</span>
                </div>
                <span className="font-bold text-brand-dark text-right flex-shrink-0 pl-2">
                  {slice.value.toFixed(0)}h ({(slice.percent * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
            {donutChartData.length > 5 && (
              <div className="text-[10px] font-semibold text-slate-400 text-center pt-0.5">
                + {donutChartData.length - 5} más áreas
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. DYNAMIC MATRIX PIVOT TABLE */}
      <div className="bg-white rounded-xl shadow-sm border border-brand-dark/10 overflow-hidden">
        <div className="p-6 border-b border-brand-dark/10 bg-slate-50/50 flex items-center justify-between">
          <h3 className="text-lg font-bold text-brand-dark">Matriz Dinámica Agrupada</h3>
          <div className="flex items-center gap-1.5 text-xs text-brand-dark/60 font-semibold bg-slate-200/50 px-3 py-1 rounded-full">
            <span className="font-bold text-brand-primary">{pivotData.rows.length}</span> filas ×{" "}
            <span className="font-bold text-brand-primary">{pivotData.cols.length}</span> columnas
          </div>
        </div>

        {pivotData.rows.length === 0 ? (
          <div className="p-12 text-center text-brand-dark/50">
            No se encontraron registros que coincidan con la combinación de filtros y agrupaciones.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-brand-dark/90">
              <thead className="bg-brand-dark/5 text-brand-dark font-bold border-b border-brand-dark/15">
                <tr>
                  <th className="px-4 py-3 bg-brand-dark/5 capitalize border-r border-brand-dark/10">
                    {rowGrouping === "tipo" ? "Tipo de tiempo" : rowGrouping}
                  </th>
                  {pivotData.cols.map((colKey) => (
                    <th key={colKey} className="px-4 py-3 text-center border-r border-brand-dark/10 last:border-0 min-w-[80px]">
                      {colKey}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-black bg-brand-primary/10 text-brand-primary">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-dark/10 font-medium">
                {pivotData.rows.map((rowKey) => {
                  let rowSum = 0;
                  let rowTotalCount = 0;

                  return (
                    <tr key={rowKey} className="hover:bg-brand-accent/5 transition-colors">
                      <td className="px-4 py-3 bg-brand-dark/5 font-semibold border-r border-brand-dark/10">
                        {rowKey}
                      </td>
                      {pivotData.cols.map((colKey) => {
                        const cellVal = pivotData.cells.get(rowKey)?.get(colKey) ?? 0;
                        const cellCount = pivotData.counts.get(rowKey)?.get(colKey) ?? 0;
                        rowSum += cellVal;
                        rowTotalCount += cellCount;

                        return (
                          <td key={colKey} className="px-4 py-3 text-center border-r border-brand-dark/10 last:border-0 font-semibold text-brand-dark/80">
                            {cellVal > 0 ? (
                              <div className="flex flex-col items-center">
                                <span className="font-extrabold text-brand-dark">{cellVal.toFixed(1)}h</span>
                                <span className="text-[9px] text-slate-400 font-normal">({cellCount} reg.)</span>
                              </div>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                        );
                      })}
                      {/* Row Total */}
                      <td className="px-4 py-3 text-center bg-brand-primary/5 text-brand-primary font-black border-l border-brand-primary/10">
                        <div className="flex flex-col items-center">
                          <span>{rowSum.toFixed(1)}h</span>
                          <span className="text-[9px] text-brand-primary/60 font-semibold">({rowTotalCount} reg.)</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Column Totals Row */}
                <tr className="bg-brand-dark/5 border-t-2 border-brand-dark/20 font-black">
                  <td className="px-4 py-3.5 border-r border-brand-dark/15 text-brand-dark font-black">
                    TOTAL GENERAL
                  </td>
                  {pivotData.cols.map((colKey) => {
                    const colSum = pivotData.colTotals.get(colKey) ?? 0;
                    const colCount = pivotData.colCounts.get(colKey) ?? 0;

                    return (
                      <td key={colKey} className="px-4 py-3.5 text-center border-r border-brand-dark/15 last:border-0 text-brand-dark">
                        <div className="flex flex-col items-center">
                          <span>{colSum.toFixed(1)}h</span>
                          <span className="text-[9px] text-slate-500 font-normal">({colCount} reg.)</span>
                        </div>
                      </td>
                    );
                  })}
                  {/* Grand Total */}
                  <td className="px-4 py-3.5 text-center bg-brand-primary/15 text-brand-primary font-black">
                    <div className="flex flex-col items-center">
                      <span className="text-base">{pivotData.grandTotalHours.toFixed(1)}h</span>
                      <span className="text-[9px] text-brand-primary font-semibold">({pivotData.grandTotalRecords} reg.)</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
