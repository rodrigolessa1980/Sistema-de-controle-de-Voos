/**
 * O cadastro de `Client` que dá escopo a um usuário do perfil Cliente.
 *
 * O perfil Cliente não é um papel que "vê menos": é um papel cujo `where` é
 * fechado por `clientId` (docs/PLANO.md §4.2, a segunda das três camadas). Sem
 * `Client` vinculado, o escopo é `null` e a pessoa entra num sistema onde toda
 * lista vem vazia — pior que não entrar, porque parece defeito.
 *
 * Isto nasceu dentro da rota de liberação em `modules/user.ts`. O autocadastro
 * passou a precisar exatamente do mesmo, e a segunda cópia seria a que esquece
 * de reaproveitar o cliente já existente — o erro caro, porque parte o histórico
 * de viagens e cobranças em dois.
 */

import { recordChange } from './changefeed';
import { notFound } from './errors';
import type { Db } from './prisma';

export interface ClientLinkInput {
  readonly name: string;
  readonly email: string;
  /** Cliente escolhido à mão. Ausente = resolve pelo e-mail. */
  readonly clientId?: string | undefined;
}

/**
 * Devolve o id do `Client` a vincular, criando um se for preciso.
 *
 * `actorId` é quem responde pelo evento no change feed — o administrador, quando
 * a liberação é dele; o próprio usuário, no autocadastro.
 */
export async function resolveClientForUser(
  tx: Db,
  input: ClientLinkInput,
  actorId: string,
): Promise<string> {
  if (input.clientId !== undefined) {
    const escolhido = await tx.client.findFirst({
      where: { id: input.clientId, deletedAt: null },
      select: { id: true },
    });
    if (!escolhido) throw notFound('Cliente');
    return escolhido.id;
  }

  /**
   * Reaproveita o cadastro que já existir com este e-mail.
   *
   * O caso comum é o cliente já estar na base (cadastrado pelo operacional) e só
   * agora pedir acesso ao portal. Criar um segundo `Client` com o mesmo e-mail
   * partiria o histórico de viagens e cobranças dele em dois, e o portal
   * mostraria metade.
   */
  const existente = await tx.client.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true },
  });
  if (existente) return existente.id;

  const criado = await tx.client.create({
    data: { name: input.name, email: input.email },
    select: { id: true },
  });

  await recordChange(tx, { entity: 'client', entityId: criado.id, action: 'created' }, actorId);

  return criado.id;
}
