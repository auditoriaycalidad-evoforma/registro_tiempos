-- Migración aditiva e idempotente para:
-- 1. Notificaciones Push (suscripciones + log con deduplicación)
-- 2. Cierre automático de actividades (relación origen-destino + marca generado_automaticamente + log idempotente)
-- NO modifica public.horarios ni datos históricos existentes.

BEGIN;

-- 1. Columnas aditivas en public.minuta_registro_actividad (históricos conservan FALSE / NULL)
ALTER TABLE public.minuta_registro_actividad
  ADD COLUMN IF NOT EXISTS cierre_automatico BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS generado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS registro_origen_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_registro_origen'
      AND conrelid = 'public.minuta_registro_actividad'::regclass
  ) THEN
    ALTER TABLE public.minuta_registro_actividad
      ADD CONSTRAINT fk_registro_origen
      FOREIGN KEY (registro_origen_id)
      REFERENCES public.minuta_registro_actividad(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_minuta_registro_origen_id
  ON public.minuta_registro_actividad (registro_origen_id)
  WHERE registro_origen_id IS NOT NULL;

-- 2. Columnas aditivas en public.minuta_actividad_activa
ALTER TABLE public.minuta_actividad_activa
  ADD COLUMN IF NOT EXISTS generado_automaticamente BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS registro_origen_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_actividad_activa_registro_origen'
      AND conrelid = 'public.minuta_actividad_activa'::regclass
  ) THEN
    ALTER TABLE public.minuta_actividad_activa
      ADD CONSTRAINT fk_actividad_activa_registro_origen
      FOREIGN KEY (registro_origen_id)
      REFERENCES public.minuta_registro_actividad(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Tabla de suscripciones Web Push (relacionada estrictamente por número de documento empleado_id)
CREATE TABLE IF NOT EXISTS public.minuta_push_suscripcion (
  id SERIAL PRIMARY KEY,
  empleado_id VARCHAR(64) NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent VARCHAR(512) NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_push_suscripcion_empleado
    FOREIGN KEY (empleado_id)
    REFERENCES public.minuta_empleado(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_push_suscripcion_empleado_activa
  ON public.minuta_push_suscripcion (empleado_id, activa);

-- 4. Tabla de log de notificaciones push (idempotencia por empleado + fecha + tipo_evento + hora_programada)
CREATE TABLE IF NOT EXISTS public.minuta_notificacion_log (
  id SERIAL PRIMARY KEY,
  empleado_id VARCHAR(64) NOT NULL,
  fecha DATE NOT NULL,
  tipo_evento VARCHAR(20) NOT NULL,
  hora_programada TIME NOT NULL,
  mensaje TEXT NOT NULL,
  estado VARCHAR(20) NOT NULL,
  suscripciones_intentadas INTEGER NOT NULL DEFAULT 0,
  suscripciones_exitosas INTEGER NOT NULL DEFAULT 0,
  error_detalle TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_notificacion_idempotencia
    UNIQUE (empleado_id, fecha, tipo_evento, hora_programada)
);

CREATE INDEX IF NOT EXISTS idx_notificacion_log_fecha_estado
  ON public.minuta_notificacion_log (fecha DESC, created_at DESC);

-- 5. Tabla de log de cierres automáticos (idempotencia por empleado + fecha + hora_fin_programada)
CREATE TABLE IF NOT EXISTS public.minuta_cierre_automatico_log (
  id SERIAL PRIMARY KEY,
  empleado_id VARCHAR(64) NOT NULL,
  fecha DATE NOT NULL,
  hora_fin_programada TIME NOT NULL,
  registro_cerrado_id INTEGER NULL,
  registro_nuevo_id INTEGER NULL,
  tipo_original VARCHAR(1) NOT NULL,
  estado VARCHAR(30) NOT NULL,
  detalle TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cierre_auto_idempotencia
    UNIQUE (empleado_id, fecha, hora_fin_programada),
  CONSTRAINT fk_cierre_auto_registro_cerrado
    FOREIGN KEY (registro_cerrado_id)
    REFERENCES public.minuta_registro_actividad(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_cierre_auto_registro_nuevo
    FOREIGN KEY (registro_nuevo_id)
    REFERENCES public.minuta_registro_actividad(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cierre_auto_log_fecha
  ON public.minuta_cierre_automatico_log (fecha DESC, created_at DESC);

COMMIT;
