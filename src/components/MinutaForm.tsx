"use client";

import { useRef, useState } from "react";
import { createMinuta } from "@/app/actions/minuta";
import { Plus, Trash2, Calendar, Folder, BookOpen, Clock, AlertCircle } from "lucide-react";

interface TimeRange {
  id: string;
  proyecto: string;
  actividad: string;
  horaInicio: string;
  horaFin: string;
  observacion: string;
}

export function MinutaForm({ proyectos, actividades }: { proyectos: any[]; actividades: any[] }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ranges, setRanges] = useState<TimeRange[]>([
    { id: "initial", proyecto: "", actividad: "", horaInicio: "", horaFin: "", observacion: "" }
  ]);
  const formRef = useRef<HTMLFormElement>(null);

  // Calcular la fecha mínima y máxima permitida (hoy - 2 días a hoy + 2 días)
  const hoy = new Date();
  
  const hoyMin = new Date(hoy);
  hoyMin.setDate(hoyMin.getDate() - 2);
  const yyyyMin = hoyMin.getFullYear();
  const mmMin = String(hoyMin.getMonth() + 1).padStart(2, '0');
  const ddMin = String(hoyMin.getDate()).padStart(2, '0');
  const minDate = `${yyyyMin}-${mmMin}-${ddMin}`;

  const hoyMax = new Date(hoy);
  hoyMax.setDate(hoyMax.getDate() + 2);
  const yyyyMax = hoyMax.getFullYear();
  const mmMax = String(hoyMax.getMonth() + 1).padStart(2, '0');
  const ddMax = String(hoyMax.getDate()).padStart(2, '0');
  const maxDate = `${yyyyMax}-${mmMax}-${ddMax}`;

  const addRange = () => {
    if (ranges.length < 7) {
      setRanges([...ranges, { 
        id: Math.random().toString(), 
        proyecto: "", 
        actividad: "", 
        horaInicio: "", 
        horaFin: "", 
        observacion: "" 
      }]);
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
        let finalVal = value;
        if (field === "horaInicio" || field === "horaFin") {
          let cleanVal = value.replace(/[^0-9:]/g, "");
          if (cleanVal.length === 2 && !cleanVal.includes(":")) {
            cleanVal = cleanVal + ":";
          }
          if (cleanVal.length > 5) {
            cleanVal = cleanVal.slice(0, 5);
          }
          finalVal = cleanVal;
        }
        return { ...r, [field]: finalVal };
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
          return `Las horas en el rango #${i + 1} deben tener un formato de 24 horas válido (Ej: 08:30).`;
        }
        
        const [sh, sm] = r.horaInicio.split(":").map(Number);
        const [eh, em] = r.horaFin.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        
        if (endMin <= startMin) {
          return `En el rango #${i + 1}, la hora de fin debe ser posterior a la de inicio.`;
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
          return `El rango #${rangeI.index + 1} (${rangeI.rawStart} - ${rangeI.rawEnd}) se solapa con el rango #${rangeJ.index + 1} (${rangeJ.rawStart} - ${rangeJ.rawEnd}).`;
        }
      }
    }
    return null;
  };

  const overlapError = getOverlapError();

  async function action(formData: FormData) {
    // Validar campos principales
    const tipoInput = formData.get("tipo") as string;
    const fechaInput = formData.get("fecha") as string;
    if (!tipoInput || !fechaInput) {
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
    }

    if (overlapError) {
      setError(overlapError);
      return;
    }

    // Validar fecha en el cliente también
    if (fechaInput) {
      const hoyVal = new Date();
      const hoySoloFecha = new Date(hoyVal.getFullYear(), hoyVal.getMonth(), hoyVal.getDate());
      const limiteMinimo = new Date(hoySoloFecha);
      limiteMinimo.setDate(limiteMinimo.getDate() - 2);
      const limiteMaximo = new Date(hoySoloFecha);
      limiteMaximo.setDate(limiteMaximo.getDate() + 2);
      
      const [year, month, day] = fechaInput.split("-").map(Number);
      const fechaIngresada = new Date(year, month - 1, day);
      
      if (fechaIngresada < limiteMinimo || fechaIngresada > limiteMaximo) {
        setError("La fecha seleccionada no está permitida");
        return;
      }
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    const res = await createMinuta(formData);
    
    if (res?.error) {
      setError(res.error);
    } else {
      setSuccess(true);
      formRef.current?.reset();
      setRanges([{ id: "initial", proyecto: "", actividad: "", horaInicio: "", horaFin: "", observacion: "" }]);
    }
    setLoading(false);
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

      <form ref={formRef} action={action} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-semibold text-brand-dark/90 mb-1.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-primary"></span>
              Tipo de Tiempo
            </label>
            <select 
              name="tipo" 
              required 
              className="w-full rounded-lg border border-brand-dark/20 px-3.5 py-2.5 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-brand-light/50 text-sm"
            >
              <option value="">Seleccione un tipo</option>
              <option value="A">Tipo A</option>
              <option value="O">Tipo O</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-brand-dark/90 mb-1.5 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-brand-primary" />
              Fecha
            </label>
            <input 
              type="date" 
              name="fecha" 
              required 
              min={minDate}
              max={maxDate}
              className="w-full rounded-lg border border-brand-dark/20 px-3.5 py-2.5 text-brand-dark focus:outline-none focus:ring-2 focus:ring-brand-primary/50 focus:border-brand-primary transition-all bg-brand-light/50 text-sm" 
            />
          </div>
        </div>

        {/* Sección agrupada de Rangos de Tiempo */}
        <div className="bg-slate-50 rounded-xl p-5 border border-brand-dark/10 space-y-4">
          <div className="flex justify-between items-center border-b border-brand-dark/10 pb-3">
            <h3 className="text-sm font-bold text-brand-dark/90 tracking-wide uppercase">Rangos de Tiempo</h3>
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
                    <select 
                      name={`proyecto_${index}`} 
                      required 
                      value={r.proyecto}
                      onChange={(e) => handleRangeFieldChange(r.id, "proyecto", e.target.value)}
                      className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-xs text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary bg-brand-light/50"
                    >
                      <option value="">Seleccione una cédula</option>
                      {proyectos.map((p) => (
                        <option key={p.code} value={p.code}>{p.code}</option>
                      ))}
                    </select>
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
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Actividad</label>
                    <select 
                      name={`actividad_${index}`} 
                      required 
                      value={r.actividad}
                      onChange={(e) => handleRangeFieldChange(r.id, "actividad", e.target.value)}
                      className="w-full rounded-md border border-brand-dark/20 px-3 py-2 text-xs text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary bg-brand-light/50"
                    >
                      <option value="">Seleccione una actividad</option>
                      {actividades.map((a) => (
                        <option key={a.code} value={a.code}>{a.nombre} {a.area ? `(${a.area})` : ''}</option>
                      ))}
                    </select>
                  </div>

                  {/* Horario */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Inicio</label>
                      <input
                        type="text"
                        name={`horaInicio_${index}`}
                        placeholder="Ej: 08:00"
                        value={r.horaInicio}
                        onChange={(e) => handleRangeFieldChange(r.id, "horaInicio", e.target.value)}
                        pattern="^([01]\d|2[0-3]):[0-5]\d$"
                        maxLength={5}
                        inputMode="numeric"
                        required
                        className="w-full h-9 rounded-md border border-brand-dark/20 px-2.5 py-1 text-xs text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-brand-dark/80 mb-1">Hora Fin</label>
                      <input
                        type="text"
                        name={`horaFin_${index}`}
                        placeholder="Ej: 17:30"
                        value={r.horaFin}
                        onChange={(e) => handleRangeFieldChange(r.id, "horaFin", e.target.value)}
                        pattern="^([01]\d|2[0-3]):[0-5]\d$"
                        maxLength={5}
                        inputMode="numeric"
                        required
                        className="w-full h-9 rounded-md border border-brand-dark/20 px-2.5 py-1 text-xs text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary"
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
