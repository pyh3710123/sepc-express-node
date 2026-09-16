import { Router, type RequestHandler } from 'express';

const router = Router();

const healthHandler: RequestHandler = (_request, response) => {
  response.status(200).json({ status: 'ok' });
};

router.get('/', healthHandler);

export default router;
