/**
 * Configurações — protótipo: `OpConfig` (abas Geral e Margem entre voos).
 *
 * Registro único (`id = "singleton"`). Se não existir, é criado com os padrões
 * — assim o sistema nunca fica sem `marginMinutes` e o `checkConflict` sempre
 * tem um valor com que trabalhar.
 */

import { settingsSchema, updateSettingsBodySchema, type Settings } from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { recordChange } from '../lib/changefeed';
import { type Prisma, prisma, type Db } from '../lib/prisma';
import { requirePermission, requireUser } from '../plugins/rbac';

export const SETTINGS_ID = 'singleton';

const settingsSelect = {
  companyName: true,
  contactEmail: true,
  timezone: true,
  marginMinutes: true,
  dueSoonDays: true,
  documentRetentionDays: true,
  notifyOnNewRequest: true,
  notifyExtraEmails: true,
} as const;

export type SettingsRow = Prisma.SettingsGetPayload<{ select: typeof settingsSelect }>;

const DEFAULTS = {
  companyName: 'Air Charter Manager',
  contactEmail: 'operacoes@aircharter.com.br',
  timezone: 'America/Sao_Paulo',
  marginMinutes: 45,
  dueSoonDays: 15,
  documentRetentionDays: 365,
  notifyOnNewRequest: true,
  notifyExtraEmails: null,
} as const;

/**
 * Lê as configurações, criando o registro se ainda não existir.
 *
 * Aceita um `tx` para ser chamada de dentro de uma transação (é o caso do
 * agendamento, que precisa da margem para verificar conflito).
 */
export async function getSettings(db: Db = prisma): Promise<SettingsRow> {
  const existing = await db.settings.findUnique({
    where: { id: SETTINGS_ID },
    select: settingsSelect,
  });
  if (existing) return existing;

  return db.settings.create({
    data: { id: SETTINGS_ID, ...DEFAULTS },
    select: settingsSelect,
  });
}

export function toSettingsDTO(row: SettingsRow): Settings {
  return {
    companyName: row.companyName,
    contactEmail: row.contactEmail,
    timezone: row.timezone,
    marginMinutes: row.marginMinutes,
    dueSoonDays: row.dueSoonDays,
    documentRetentionDays: row.documentRetentionDays,
    notifyOnNewRequest: row.notifyOnNewRequest,
    notifyExtraEmails: row.notifyExtraEmails,
  };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get(
    '/',
    {
      preValidation: requirePermission('settings:read'),
      schema: { response: { 200: settingsSchema } },
    },
    async () => toSettingsDTO(await getSettings()),
  );

  route.patch(
    '/',
    {
      preValidation: requirePermission('settings:update'),
      schema: { body: updateSettingsBodySchema, response: { 200: settingsSchema } },
    },
    async (request) => {
      const user = requireUser(request);
      const body = request.body;

      return prisma.$transaction(async (tx) => {
        const before = await getSettings(tx);

        const row = await tx.settings.update({
          where: { id: SETTINGS_ID },
          data: {
            ...(body.companyName === undefined ? {} : { companyName: body.companyName }),
            ...(body.contactEmail === undefined ? {} : { contactEmail: body.contactEmail }),
            ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
            ...(body.marginMinutes === undefined ? {} : { marginMinutes: body.marginMinutes }),
            ...(body.dueSoonDays === undefined ? {} : { dueSoonDays: body.dueSoonDays }),
            ...(body.documentRetentionDays === undefined
              ? {}
              : { documentRetentionDays: body.documentRetentionDays }),
            ...(body.notifyOnNewRequest === undefined
              ? {}
              : { notifyOnNewRequest: body.notifyOnNewRequest }),
            ...(body.notifyExtraEmails === undefined
              ? {}
              : { notifyExtraEmails: body.notifyExtraEmails ?? null }),
            updatedById: user.id,
          },
          select: settingsSelect,
        });

        await recordChange(
          tx,
          { entity: 'settings', entityId: SETTINGS_ID, action: 'updated' },
          user.id,
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'settings.update',
            entity: 'settings',
            entityId: SETTINGS_ID,
            before: before,
            after: row,
          },
        });

        return toSettingsDTO(row);
      });
    },
  );
}
