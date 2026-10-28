-- El UNIQUE original distingue mayúsculas: "Mesa 1" y "mesa 1" convivían.
-- Este índice rechaza también los duplicados que solo difieren en mayúsculas
-- o en espacios laterales (el servicio ya recorta el nombre antes de guardar).
CREATE UNIQUE INDEX restaurant_tables_name_unique_ci ON restaurant_tables (lower(btrim(name)));
