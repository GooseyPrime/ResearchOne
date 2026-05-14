import { z } from 'zod';

const uuidParam = z.string().uuid('Invalid dossier id');

export const dossierIdParamSchema = z.object({
  id: uuidParam,
});

export const dossierListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  intent: z.string().min(1).max(64).optional(),
  status: z.string().min(1).max(64).optional(),
  dateFrom: z.string().max(64).optional(),
  dateTo: z.string().max(64).optional(),
});

export type DossierListQuery = z.infer<typeof dossierListQuerySchema>;
