import { z } from 'zod';

const uuidParam = z.string().uuid('Invalid dossier id');

/** Query values cast to `timestamptz` in SQL — must parse so bad input returns 400, not 500. */
const optionalTimestamptzQuery = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid date or date-time' })
  .optional();

export const dossierIdParamSchema = z.object({
  id: uuidParam,
});

export const dossierListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  intent: z.string().min(1).max(64).optional(),
  status: z.string().min(1).max(64).optional(),
  dateFrom: optionalTimestamptzQuery,
  dateTo: optionalTimestamptzQuery,
});

export type DossierListQuery = z.infer<typeof dossierListQuerySchema>;
