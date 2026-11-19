BEGIN;

-- Convertir hora de inicio a TIME
ALTER TABLE public.horarios
ALTER COLUMN hora_inicio TYPE TIME
USING
    to_timestamp(
        regexp_replace(
            lower(trim(hora_inicio)),
            '[[:space:].]',
            '',
            'g'
        ),
        'HH12:MIAM'
    )::TIME;

-- Convertir hora de finalización a TIME
ALTER TABLE public.horarios
ALTER COLUMN hora_fin TYPE TIME
USING
    to_timestamp(
        regexp_replace(
            lower(trim(hora_fin)),
            '[[:space:].]',
            '',
            'g'
        ),
        'HH12:MIAM'
    )::TIME;

-- Agregar el campo cargo si todavía no existe
ALTER TABLE public.horarios
ADD COLUMN IF NOT EXISTS cargo VARCHAR(150);

COMMIT;