"use client";

import { useState, useEffect, useCallback } from "react";

export interface GeolocationState {
  ubicacion: string;
  ciudad?: string;
  localidad?: string;
  lat: number | null;
  lng: number | null;
  loading: boolean;
  error: string | null;
  timestamp: number | null;
}

export function useGeolocation(autoDetect: boolean = true) {
  const [geoState, setGeoState] = useState<GeolocationState>({
    ubicacion: "",
    ciudad: "",
    localidad: "",
    lat: null,
    lng: null,
    loading: false,
    error: null,
    timestamp: null,
  });

  const detectLocation = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      setGeoState((prev) => ({
        ...prev,
        loading: false,
        error: "Geolocalización no soportada en este dispositivo o navegador.",
      }));
      return;
    }

    setGeoState((prev) => ({ ...prev, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const now = Date.now();

        try {
          // Consultar endpoint de geocodificación inversa
          const res = await fetch(`/api/geolocalizacion?lat=${lat}&lng=${lng}`, {
            cache: "no-store",
          });
          const data = await res.json();

          const resolvedUbicacion = data?.ubicacion || `Coord: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

          const newState: GeolocationState = {
            ubicacion: resolvedUbicacion,
            ciudad: data?.ciudad || "",
            localidad: data?.localidad || "",
            lat,
            lng,
            loading: false,
            error: null,
            timestamp: now,
          };

          setGeoState(newState);

          // Guardar en sessionStorage para agilizar recargas
          try {
            sessionStorage.setItem("evo_cached_geo", JSON.stringify(newState));
          } catch {}
        } catch (err: any) {
          const fallbackUbicacion = `Lat: ${lat.toFixed(3)}, Lng: ${lng.toFixed(3)}`;
          setGeoState({
            ubicacion: fallbackUbicacion,
            ciudad: "",
            localidad: "",
            lat,
            lng,
            loading: false,
            error: null,
            timestamp: now,
          });
        }
      },
      (geoError) => {
        let errorMsg = "No se pudo obtener la ubicación.";
        if (geoError.code === geoError.PERMISSION_DENIED) {
          errorMsg = "Permiso de ubicación denegado por el usuario.";
        } else if (geoError.code === geoError.POSITION_UNAVAILABLE) {
          errorMsg = "Ubicación GPS no disponible.";
        } else if (geoError.code === geoError.TIMEOUT) {
          errorMsg = "Tiempo de espera agotado al obtener ubicación.";
        }

        setGeoState((prev) => ({
          ...prev,
          loading: false,
          error: errorMsg,
          ubicacion: prev.ubicacion || "",
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, []);

  useEffect(() => {
    // Intentar recuperar del caché de sesión primero
    try {
      const cached = sessionStorage.getItem("evo_cached_geo");
      if (cached) {
        const parsed = JSON.parse(cached);
        // Si tiene menos de 15 minutos, usarlo
        if (parsed && Date.now() - (parsed.timestamp || 0) < 15 * 60 * 1000) {
          setGeoState({ ...parsed, loading: false });
          return;
        }
      }
    } catch {}

    if (autoDetect) {
      detectLocation();
    }
  }, [autoDetect, detectLocation]);

  return {
    ...geoState,
    refreshLocation: detectLocation,
  };
}
