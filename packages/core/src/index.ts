import { z } from 'zod';

export const APP_NAME = 'Joinpath';

export const healthSchema = z.object({ status: z.literal('ok') });
export type Health = z.infer<typeof healthSchema>;
