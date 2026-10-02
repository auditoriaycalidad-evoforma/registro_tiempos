"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Calendar, Folder, BookOpen, Clock, AlertCircle, User, Lock } from "lucide-react";
import { useSession } from "next-auth/react";
import { SearchableSelect } from "./SearchableSelect";
import { TimePicker12 } from "./TimePicker12";
import { formatTime12 } from "@/lib/formatTime";

interface TimeRange {
  id: string;
  proyecto: string;
  actividad: string;
  horaInicio: string; // 24h format "HH:MM"
  horaFin: string;    // 24h format "HH:MM"
  observacion: string;
}

interface EmpleadoOption {
  id: string;
  apellido_nombre: string;
  cargo?: string | null;
}

export function MinutaForm({ 
  proyectos, 
  actividades,
  empleados = [],
  canSelectEmpleado = false,
  defaultEmpleadoId = "",
  isAdmin: propIsAdmin,
}: { 
  proyectos: any[]; 
  actividades: any[];
  empleados?: EmpleadoOption[];
  canSelectEmpleado?: boolean;
  defaultEmpleadoId?: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();

  const userEmail = session?.user?.email?.toLowerCase().trim();
  const allowedAdminEmails = ["ia.evoforma@gmail.com", "auditoriaycalidad@evoforma.net"];
  const isAdmin = propIsAdmin ?? (session?.user?.rol === "ADMIN" || (userEmail ? allowedAdminEmails.includes(userEmail) : false));

  const getTodayLocal = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const [selectedEmpleado, setSelectedEmpleado] = useState<string>(defaultEmpleadoId);
  const [tipo, setTipo] = useState<string>("");
  const [fecha, setFecha] = useState<string>(getTodayLocal());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ranges, setRanges] = useState<TimeRange[]>([
    { id: "initial", proyecto: "", actividad: "", horaInicio: "", horaFin: "", observacion: "" }
  ]);
  const formRef = useRef<HTMLFormElement>(null);

  // Asegurar que para usuarios estándar la fecha esté siempre sincronizada con hoy
  useEffect(() => {
    if (!isAdmin) {
      setFecha(getTodayLocal());
    }
  }, [isAdmin]);

  const addRange = () => {
    if (ranges.length < 7) {
      setRanges([
        ...ranges, 
        { 
          id: Math.random().toString(), 
          proyecto: "", 
          actividad: "", 
          horaInicio: "", 
          horaFin: "", 
          observacion: "" 
        }
      ]);
    }
  };

  const removeRange = (id: string) => {
    if (ranges.length > 1) {
      setRanges(ranges.filter(r => r.id !== id));
    }
  };

  const handleRangeFieldChange = (id: string, field: keyof TimeRange, value: string) => {
    setRanges(prev => prev.map(r => {
      if (r.id === id) {
        return { ...r, [field]: value };
      }
      return r;
    }));
  };

  // Validation function
  function calculateHours(startStr: string, endStr: string): number {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(startStr) || !timePattern.test(endStr)) return 0;
    const [sh, sm] = startStr.split(":").map(Number);
    const [eh, em] = endStr.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) return 0;
    return (endMin - startMin) / 60;
  }

  const totalHours = ranges.reduce((acc, r) => acc + calculateHours(r.horaInicio, r.horaFin), 0);

  const getOverlapError = () => {
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    
    // Validar formato y consistencia interna por rango
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (r.proyecto || r.actividad || r.horaInicio || r.horaFin || r.observacion) {
        if (!r.proyecto || !r.actividad || !r.horaInicio || !r.horaFin) {
          return `Debe completar Cédula, Actividad, Hora de Inicio y Hora de Fin en el rango #${i + 1}.`;
        }
        
        if (!timePattern.test(r.horaInicio) || !timePattern.test(r.horaFin)) {
          return `Debe seleccionar una hora de inicio y fin válida para el rango #${i + 1}.`;
        }
        
        const [sh, sm] = r.horaInicio.split(":").map(Number);
        const [eh, em] = r.horaFin.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        
        if (endMin <= startMin) {
          return `En el rango #${i + 1}, la hora de fin (${formatTime12(r.horaFin)}) debe ser posterior a la de inicio (${formatTime12(r.horaInicio)}).`;
        }
      }
    }

    // Validar solapamientos
    const validRanges = ranges
      .map((r, index) => {
        const startValid = timePattern.test(r.horaInicio);
        const endValid = timePattern.test(r.horaFin);
        if (!startValid || !endValid) return null;
        const [sh, sm] = r.horaInicio.split(":").map(Number);
        const [eh, em] = r.horaFin.split(":").map(Number);
        return {
          index,
          start: sh * 60 + sm,
          end: eh * 60 + em,
          rawStart: r.horaInicio,
          rawEnd: r.horaFin
        };
      })
      .filter(Boolean) as { index: number; start: number; end: number; rawStart: string; rawEnd: string }[];

    for (let i = 0; i < validRanges.length; i++) {
      const rangeI = validRanges[i];
      for (let j = i + 1; j < validRanges.length; j++) {
        const rangeJ = validRanges[j];
        if (rangeI.start < rangeJ.end && rangeJ.start < rangeI.end) {
          return `El rango #${rangeI.index + 1} (${formatTime12(rangeI.rawStart)} - ${formatTime12(rangeI.rawEnd)}) se solapa con el rango #${rangeJ.index + 1} (${formatTime12(rangeJ.rawStart)} - ${formatTime12(rangeJ.rawEnd)}).`;
        }
      }
    }
    return null;
  };

  const overlapError = getOverlapError();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const finalFecha = isAdmin ? fecha : getTodayLocal();

    // Validar campos principales
    if (!tipo || !finalFecha) {
      setError("Todos los campos principales son obligatorios (Tipo de Tiempo y Fecha).");
      return;
    }

    // Validar completez de todos los campos en todos los rangos (excepto observacion)
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (!r.proyecto || !r.actividad || !r.horaInicio || !r.horaFin) {
        setError(`Debe completar Cédula, Actividad, Hora de Inicio y Hora de Fin en el rango #${i + 1}.`);
        return;
      }

      const proyectoInfo = proyectos.find(p => p.code === r.proyecto);
      if (!proyectoInfo || !proyectoInfo.nombre) {
        setError(`El proyecto con cédula "${r.proyecto}" no es válido. Debe seleccionar un proyecto válido de la base de datos.`);
        return;
      }
    }

    if (overlapError) {
      setError(overlapError);
      return;
    }

    if (canSelectEmpleado && !selectedEmpleado) {
      setError("Debe seleccionar un colaborador (Apellido - Nombre).");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    const payload = {
      empleado: canSelectEmpleado ? selectedEmpleado : defaultEmpleadoId || undefined,
      tipo,
      fecha: finalFecha,
      intervals: ranges.map((r) => ({
        proyecto: r.proyecto.trim(),
        actividad: r.actividad.trim(),
        horaInicio: r.horaInicio.trim(),
        horaFin: r.horaFin.trim(),
        observacion: r.observacion?.trim() || "",
      })),
    };

    try {
      const res = await fetch("/api/minuta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        setError(data?.error || "Error al registrar el tiempo");
      } else {
        setSuccess(true);
        setTipo("");
        if (isAdmin) {
          setFecha(getTodayLocal());
        }
        setSelectedEmpleado(defaultEmpleadoId);
        setRanges([{ id: Math.random().toString(), proyecto: "", actividad: "", horaInicio: "", horaFin: "", observacion: "" }]);
        router.refresh();
      }
    } catch (err: any) {
      setError(err?.message || "Error de conexión al guardar el registro");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full bg-white rounded-xl shadow-md border border-brand-dark/10 p-6 md:p-8 hover:shadow-lg transition-shadow duration-300">
      <div className="flex items-center gap-3 mb-6 border-b border-brand-dark/10 pb-4">
        <Clock className="w-6 h-6 text-brand-primary" />
        <h2 className="text-2xl font-extrabold text-brand-dark">Nuevo Registro de Tiempo</h2>
      </div>
      
      {error && (
        <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-500 text-red-700 rounded-r-md text-sm flex items-start gap-2.5 animate-fadeIn">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border-l-4 border-green-500 text-green-700 rounded-r-md text-sm flex items-center gap-2.5 animate-fadeIn">
          <span className="font-semibold">✓</span>
          <span>Tiempo registrado correctamente</span>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
        {canSelectEmpleado && empleados.length > 0 && (
          <div>
            <label className="block text-sm font-semibold text-brand-dark/90 mb-1.5 flex items-center gap-1.5">
              <User className="w-4 h-4 text-brand-primary" />
              Apellido - Nombre (Colaborador)
            </label>
            <SearchableSelect
              name="empleado"
              value={selectedEmpleado}
              onChange={(val) => setSelectedEmpleado(val)}
              options={empleados.map((emp) => ({
                value: emp.id,
                label: emp.apellido_nombre,
                sublabel: emp.cargo ? `(${emp.cargo})` : undefined,
              }))}
              placeholder="Seleccione o busque un colaborador"
              required
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Tipo de Tiempo */}
          <div>
            <label className="block text-sm font-semibold text-brand-dark/90 mb-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-primary"></span>
              Tipo de Tiempo
            </label>
            <select 
              name="tipo" 
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              required 
              className="w-full rounded-lg border border-brand-dark/20 px-3.5 py-2.5 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-brand-light/50 text-sm"
            >
              <option value="">Seleccione un tipo</option>
              <option value="P">Tipo P</option>
              <option value="O">Tipo O</option>
            </select>
          </div>

          {/* Fecha */}
          <div>
            <label className="block text-sm font-semibold text-brand-dark/90 mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-brand-primary" />
                <span>Fecha</span>
              </div>
              {!isAdmin && (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                  <Lock className="w-3 h-3" /> Solo lectura (Hoy)
                </span>
              )}
            </label>

            {isAdmin ? (
              <input 
                type="date" 
                name="fecha" 
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required 
                className="w-full rounded-lg border border-brand-dark/20 px-3.5 py-2.5 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-white text-sm" 
              />
            ) : (
              <div className="relative">
                <input 
                  type="date" 
                  name="fecha" 
                  value={getTodayLocal()}
                  readOnly
                  disabled
                  className="w-full rounded-lg border border-brand-dark/15 px-3.5 py-2.5 text-brand-dark/70 bg-slate-100 cursor-not-allowed text-sm font-medium select-none" 
                />
              </div>
            )}
          </div>
        </div>

        {/* Sección agrupada de Rangos de Tiempo */}
        <div className="bg-slate-50 rounded-xl p-5 border border-brand-dark/10 space-y-4">
          <div className="flex justify-between items-center border-b border-brand-dark/10 pb-3">
            <h3 className="text-sm font-bold text-brand-dark/90 tracking-wide uppercase">Rangos de Tiempo (Horario 12 Horas)</h3>
            <span className="text-xs bg-brand-primary/10 text-brand-primary px-2.5 py-1 rounded-full font-semibold">
              Máx. 7 rangos
            </span>
          </div>

          <div className="space-y-4">
            {ranges.map((r, index) => (
              <div 
                key={r.id} 
                className="p-4 bg-white rounded-xl border border-brand-dark/10 shadow-sm space-y-4 relative hover:border-brand-primary/20 transition-all duration-200"
              >
                <div className="flex justify-between items-center border-b border-brand-dark/5 pb-2">
                  <span className="text-xs font-bold text-brand-primary uppercase">Rango #{index + 1}</span>
                  {ranges.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeRange(r.id)}
                      className="text-red-500 hover:text-red-700 transition-colors p-1"
                      title="Eliminar rango"
                    >
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Cédula del Proyecto */}
                  <div>
                    <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Cédula del Proyecto</label>
                    <SearchableSelect
                      name={`proyecto_${index}`}
                      value={r.proyecto}
                      onChange={(val) => handleRangeFieldChange(r.id, "proyecto", val)}
                      options={proyectos.map((p) => ({
                        value: p.code,
                        label: p.code,
                        sublabel: p.nombre
                      }))}
                      placeholder="Seleccione o busque una cédula"
                      required
                    />
                  </div>

                  {/* Nombre del Proyecto */}
                  <div>
                    <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Nombre del Proyecto</label>
                    <input 
                      type="text" 
                      readOnly 
                      className="w-full rounded-md border border-brand-dark/20 bg-slate-100 px-3 py-2 text-xs text-brand-dark/60 focus:outline-none cursor-not-allowed font-medium"
                      value={proyectos.find(p => p.code === r.proyecto)?.nombre || ""}
                      placeholder="Nombre de la cédula"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Actividad */}
                  <div className="md:col-span-1 lg:col-span-1">
                    <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Actividad</label>
                    <SearchableSelect
                      name={`actividad_${index}`}
                      value={r.actividad}
                      onChange={(val) => handleRangeFieldChange(r.id, "actividad", val)}
                      options={actividades.map((a) => ({
                        value: a.code,
                        label: a.nombre,
                        sublabel: a.area ? `(${a.area})` : undefined
                      }))}
                      placeholder="Seleccione o busque una actividad"
                      required
                    />
                  </div>

                  {/* Horario 12H */}
                  <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Inicio (12h)</label>
                      <TimePicker12
                        id={`horaInicio_${index}`}
                        name={`horaInicio_${index}`}
                        value={r.horaInicio}
                        onChange={(val) => handleRangeFieldChange(r.id, "horaInicio", val)}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Fin (12h)</label>
                      <TimePicker12
                        id={`horaFin_${index}`}
                        name={`horaFin_${index}`}
                        value={r.horaFin}
                        onChange={(val) => handleRangeFieldChange(r.id, "horaFin", val)}
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Observación */}
                <div>
                  <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Observación</label>
                  <input
                    type="text"
                    name={`observacion_${index}`}
                    placeholder="Observaciones o detalles sobre este rango de tiempo"
                    value={r.observacion}
                    onChange={(e) => handleRangeFieldChange(r.id, "observacion", e.target.value)}
                    className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-xs text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center pt-2 gap-4">
            <button
              type="button"
              onClick={addRange}
              disabled={ranges.length >= 7}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg border border-brand-primary text-brand-primary hover:bg-brand-primary/5 active:bg-brand-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Agregar rango
            </button>

            {/* Total acumulado */}
            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 px-4 py-2 bg-brand-primary/5 border border-brand-primary/10 rounded-lg">
              <span className="text-xs font-bold text-brand-dark/70 uppercase">Total Acumulado:</span>
              <span className="text-lg font-black text-brand-primary tracking-tight">
                {totalHours.toFixed(2)} hrs
              </span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button 
            type="submit" 
            disabled={loading || !!overlapError}
            className="w-full flex justify-center py-3 px-4 rounded-lg shadow-md text-sm font-bold text-white bg-brand-primary hover:bg-brand-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.99] duration-150"
          >
            {loading ? "Guardando..." : "Registrar Tiempo"}
          </button>
        </div>
      </form>
    </div>
  );
}
