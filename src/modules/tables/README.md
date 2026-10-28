# Módulo de mesas

Tres capas, cada una con una sola responsabilidad:

| Archivo                | Responsabilidad                                                             |
| ---------------------- | --------------------------------------------------------------------------- |
| `tables.routes.ts`     | HTTP: lee la petición, llama al servicio, escribe la respuesta y el estado. |
| `tables.service.ts`    | Negocio: valida entradas (nombre, capacidad, estado, ID) y traduce errores. |
| `tables.repository.ts` | SQL parametrizado. No conoce HTTP ni reglas de validación.                  |

Todas las rutas están detrás de `requireAuth` (ver `src/app.ts`): sin sesión válida responden 401.

| Método y ruta                  | Resultado                                                           |
| ------------------------------ | ------------------------------------------------------------------- |
| `GET /api/tables`              | 200 y array de mesas                                                |
| `POST /api/tables`             | 201 y mesa creada (`available`); 400 datos inválidos; 409 duplicado |
| `PATCH /api/tables/:id/status` | 200 y mesa completa; 400 ID o estado inválido; 404 mesa inexistente |

## English

Three layers (routes → service → repository). All routes require a valid session (401 otherwise).
See [docs/SOLUCION.md](../../../docs/SOLUCION.md) for the full solution write-up.

## Русский

Три слоя (routes → service → repository). Все маршруты требуют действительной сессии (иначе 401).
Подробности — в [docs/SOLUCION.md](../../../docs/SOLUCION.md).
