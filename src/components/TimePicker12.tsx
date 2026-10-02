"use client";

import React, { useMemo } from "react";
import { militaryTo12h, toMilitaryTime } from "@/lib/formatTime";

interface TimePicker12Props {
  value: string; // Stored as "HH:MM" in 24h format for the API
  onChange: (time24: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
  name?: string;
}

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export function TimePicker12({
  value,
  onChange,
  disabled = false,
  required = false,
  className = "",
  id,
  name,
}: TimePicker12Props) {
  const { hour, minute, period } = useMemo(() => {
    return militaryTo12h(value);
  }, [value]);

  const handleHourChange = (newHour: string) => {
    if (!newHour) {
      onChange("");
      return;
    }
    const currentMin = minute || "00";
    const currentPeriod = period || "AM";
    onChange(toMilitaryTime(newHour, currentMin, currentPeriod));
  };

  const handleMinuteChange = (newMin: string) => {
    const currentHour = hour || "08";
    const currentPeriod = period || "AM";
    onChange(toMilitaryTime(currentHour, newMin, currentPeriod));
  };

  const handlePeriodChange = (newPeriod: "AM" | "PM") => {
    const currentHour = hour || "08";
    const currentMin = minute || "00";
    onChange(toMilitaryTime(currentHour, currentMin, newPeriod));
  };

  return (
    <div
      className={`inline-flex items-center justify-between gap-1 w-full h-9 rounded-lg border border-brand-dark/20 bg-white px-2 py-0.5 text-xs text-brand-dark focus-within:ring-2 focus-within:ring-brand-primary/50 focus-within:border-brand-primary transition-all ${
        disabled ? "opacity-60 bg-slate-100 cursor-not-allowed" : ""
      } ${className}`}
    >
      {/* Hidden input if form submission uses native form data */}
      {name && <input type="hidden" name={name} value={value} />}

      <div className="flex items-center flex-1 min-w-0">
        {/* Hour (12h strictly: 01 - 12) */}
        <select
          id={id ? `${id}_hour` : undefined}
          value={hour}
          disabled={disabled}
          required={required && !value}
          onChange={(e) => handleHourChange(e.target.value)}
          aria-label="Hora"
          className="bg-transparent font-semibold text-brand-dark text-xs focus:outline-none cursor-pointer p-0.5 disabled:cursor-not-allowed"
        >
          <option value="">--</option>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>

        <span className="text-brand-dark/40 font-bold px-0.5 select-none">:</span>

        {/* Minute (00 - 59) */}
        <select
          id={id ? `${id}_min` : undefined}
          value={minute}
          disabled={disabled}
          onChange={(e) => handleMinuteChange(e.target.value)}
          aria-label="Minuto"
          className="bg-transparent font-semibold text-brand-dark text-xs focus:outline-none cursor-pointer p-0.5 disabled:cursor-not-allowed"
        >
          <option value="">--</option>
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* AM / PM Selector */}
      <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-brand-dark/10 flex-shrink-0">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePeriodChange("AM")}
          className={`px-1.5 py-0.5 text-[10px] font-black rounded transition-all select-none ${
            period === "AM" && value
              ? "bg-brand-primary text-white shadow-xs"
              : "text-brand-dark/60 hover:text-brand-dark"
          } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          title="Seleccionar AM"
        >
          AM
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handlePeriodChange("PM")}
          className={`px-1.5 py-0.5 text-[10px] font-black rounded transition-all select-none ${
            period === "PM" && value
              ? "bg-brand-primary text-white shadow-xs"
              : "text-brand-dark/60 hover:text-brand-dark"
          } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
          title="Seleccionar PM"
        >
          PM
        </button>
      </div>
    </div>
  );
}
