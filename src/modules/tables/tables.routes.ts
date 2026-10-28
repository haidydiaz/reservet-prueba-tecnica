import { Router } from 'express';
import type { TablesService } from './tables.service.js';

// Solo HTTP: lee la petición, llama al servicio y escribe la respuesta.
// Express 5 envía al manejador de errores cualquier rechazo de una función async.
export function createTablesRouter(service: TablesService) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await service.list());
  });

  router.post('/', async (req, res) => {
    res.status(201).json(await service.create(req.body));
  });

  router.patch('/:id/status', async (req, res) => {
    res.json(await service.updateStatus(req.params.id, req.body));
  });

  return router;
}
