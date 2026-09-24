/**
 * Cadastro "Cliente a definir".
 *
 * Viagem e cobrança podem ser salvas sem cliente — o administrador lança o que
 * tem e completa depois pelo "Editar". Só que `client_id` é obrigatório no banco
 * (é a base do escopo por linha e dos agregados financeiros), então o registro
 * fica preso a este cadastro até alguém escolher o cliente de verdade.
 *
 * Um cadastro só, reaproveitado: sem e-mail nem documento, nunca ganha acesso ao
 * portal, então nada ligado a ele fica visível para cliente nenhum.
 */

import type { Db } from './prisma';

export const PLACEHOLDER_CLIENT_NAME = 'Cliente a definir';

/** Devolve `clientId` quando informado; senão, o id do cadastro "a definir". */
export async function resolveClientId(db: Db, clientId: string | undefined): Promise<string> {
  if (clientId !== undefined) return clientId;

  const existing = await db.client.findFirst({
    where: { name: PLACEHOLDER_CLIENT_NAME, email: null, document: null, deletedAt: null },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing.id;

  const created = await db.client.create({
    data: {
      name: PLACEHOLDER_CLIENT_NAME,
      notes:
        'Criado automaticamente para registros salvos sem cliente. Edite o registro e escolha o cliente certo.',
    },
    select: { id: true },
  });
  return created.id;
}
