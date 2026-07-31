"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Option {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder: string;
  required?: boolean;
}

export function SearchableSelect({
  name,
  value,
  onChange,
  options,
  placeholder,
  required = false
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Buscar la opción seleccionada actualmente
  const selectedOption = options.find(o => o.value === value);

  // Sincronizar el texto de búsqueda con la opción seleccionada cuando el dropdown está cerrado
  useEffect(() => {
    if (!isOpen) {
      setSearch(selectedOption ? selectedOption.label : value || "");
    }
  }, [value, selectedOption, isOpen]);

  // Manejador para cerrar el dropdown si se hace clic fuera del componente
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filtrar las opciones basadas en el texto de búsqueda
  const filteredOptions = options.filter(opt => {
    const s = search.toLowerCase();
    return (
      opt.value.toLowerCase().includes(s) ||
      opt.label.toLowerCase().includes(s) ||
      (opt.sublabel && opt.sublabel.toLowerCase().includes(s))
    );
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    setIsOpen(true);
    
    // Si coincide de manera exacta con algún código u opción (case-insensitive), notificar al padre
    const exactMatch = options.find(
      opt => opt.value.toLowerCase() === val.toLowerCase() || opt.label.toLowerCase() === val.toLowerCase()
    );
    
    if (exactMatch) {
      onChange(exactMatch.value);
    } else {
      onChange(val);
    }
  };

  const handleSelectOption = (opt: Option) => {
    onChange(opt.value);
    setSearch(opt.label);
    setIsOpen(false);
  };

  const handleBlur = () => {
    // Retrasar levemente la lógica de blur para permitir el clic de mouse
    setTimeout(() => {
      // Buscar coincidencia exacta en opciones por código, etiqueta o subetiqueta
      const exactMatch = options.find(
        opt => opt.value.toLowerCase() === search.trim().toLowerCase() || 
               opt.label.toLowerCase() === search.trim().toLowerCase() ||
               (opt.sublabel && opt.sublabel.toLowerCase() === search.trim().toLowerCase())
      );

      if (exactMatch) {
        onChange(exactMatch.value);
        setSearch(exactMatch.label);
      } else {
        if (!search.trim()) {
          onChange("");
        } else {
          // Si es entrada libre no coincidente, mantenerla para la validación de código
          onChange(search);
        }
      }
      setIsOpen(false);
    }, 200);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Input oculto para enviar el código en los formularios y Server Actions */}
      <input type="hidden" name={name} value={value} required={required} />
      
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={handleInputChange}
          onFocus={() => {
            setIsOpen(true);
            // Seleccionar todo el texto para facilitar la reescritura
            setTimeout(() => inputRef.current?.select(), 50);
          }}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="w-full rounded-md border border-brand-dark/20 dark:border-slate-800 px-3 py-2 pr-8 text-xs text-brand-dark dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary bg-brand-light/50 dark:bg-[#1a1b22] transition-all font-medium"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-2 text-brand-dark/45 hover:text-brand-dark transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? "transform rotate-180" : ""}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1 bg-white dark:bg-[#1a1b22] border border-brand-dark/15 dark:border-slate-800 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filteredOptions.length > 0 ? (
            <div className="py-1">
              {filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    onMouseDown={(e) => {
                      e.preventDefault(); // Evitar pérdida de foco antes del clic
                      handleSelectOption(opt);
                    }}
                    className={`flex items-center justify-between px-3 py-2 text-xs cursor-pointer transition-colors ${
                      isSelected 
                        ? "bg-brand-primary/10 text-brand-primary font-semibold" 
                        : "text-brand-dark dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex flex-col">
                      <span className="font-semibold">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="text-[10px] text-brand-dark/50 dark:text-slate-400">{opt.sublabel}</span>
                      )}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-brand-primary" />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-2.5 text-xs text-brand-dark/50 dark:text-slate-400 text-center italic">
              Sin coincidencias. Escriba libremente.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
