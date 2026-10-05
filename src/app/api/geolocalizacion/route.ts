import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");

    if (!latStr || !lngStr) {
      return NextResponse.json(
        { error: "Coordenadas lat y lng son obligatorias." },
        { status: 400 }
      );
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: "Coordenadas inválidas." },
        { status: 400 }
      );
    }

    // Consultar OpenStreetMap Nominatim para geocodificación inversa
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "EvoformaMinutaApp/1.0 (auditoriaycalidad@evoforma.net)",
        "Accept-Language": "es",
      },
      // Timeout seguro de 5 segundos
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({
        ubicacion: `Coord: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
      });
    }

    const data = await response.json();
    const address = data?.address || {};

    // Extraer componentes geográficos
    // Ciudad / Municipio
    let rawCiudad =
      address.city ||
      address.town ||
      address.municipality ||
      address.county ||
      address.state_district ||
      address.state ||
      "";

    // Localidad / Zona / Barrio / Suburbio
    let rawLocalidadZona =
      address.suburb ||
      address.city_district ||
      address.neighbourhood ||
      address.borough ||
      address.quarter ||
      address.commercial ||
      address.industrial ||
      address.residential ||
      "";

    // Sanitizar nombres comunes en Colombia / LatAm
    const cleanGeoName = (str: string) => {
      if (!str) return "";
      return str
        .replace(/\bPerímetro\s+Urbano\s+/i, "")
        .replace(/\bCasco\s+urbano\s+de\s+/i, "")
        .replace(/\bCabecera\s+municipal\s+de\s+/i, "")
        .replace(/\bComuna\s+\d+\s*-\s*/i, "")
        .replace(/\bLocalidad\s+/i, "")
        .replace(/\bMunicipio\s+de\s+/i, "")
        .replace(/\bCiudad\s+de\s+/i, "")
        .replace(/\sciudad\b/i, "")
        .replace(/,\s*D\.?C\.?/i, "")
        .replace(/\s+D\.?C\.?/i, "")
        .replace(/,\s*Distrito Capital/i, "")
        .replace(/\s+Distrito Capital/i, "")
        .trim();
    };

    const ciudad = cleanGeoName(rawCiudad);
    const localidadZona = cleanGeoName(rawLocalidadZona);

    let formattedUbicacion = "";

    if (ciudad && localidadZona && ciudad.toLowerCase() !== localidadZona.toLowerCase()) {
      formattedUbicacion = `${ciudad} - ${localidadZona}`;
    } else if (ciudad) {
      formattedUbicacion = ciudad;
    } else if (localidadZona) {
      formattedUbicacion = localidadZona;
    } else if (data?.display_name) {
      // Tomar los primeros dos segmentos del display_name
      const parts = data.display_name.split(",").map((p: string) => cleanGeoName(p.trim())).filter(Boolean);
      formattedUbicacion = parts.slice(0, 2).join(" - ");
    } else {
      formattedUbicacion = `Coord: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    return NextResponse.json({
      success: true,
      ubicacion: formattedUbicacion,
      ciudad,
      localidad: localidadZona,
      lat,
      lng,
    });
  } catch (error: any) {
    console.error("Error en endpoint geolocalizacion:", error);
    return NextResponse.json({
      ubicacion: "Ubicación detectada por coordenadas",
      error: error?.message || "Error al geocodificar coordenadas",
    });
  }
}
