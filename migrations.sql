-- Cambios incrementales al esquema base (schema.sql). Se aplican en cada
-- arranque del servidor; todas las sentencias son seguras de repetir.

-- Fecha exacta de vencimiento de un gasto (ademas del dia-del-mes que ya
-- existia). Para gastos recurrentes, al cerrar el mes esta fecha avanza
-- automaticamente al mismo dia del mes siguiente.
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

-- Preferencia de cierre de mes automatico y ultimo mes cerrado, por usuario.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS auto_cierre_mensual BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_cierre_mes DATE;
