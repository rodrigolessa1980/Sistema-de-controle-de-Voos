/**
 * Quem recebe um aviso.
 *
 * A regra do repositório é amarrar o destinatário em PERMISSÃO, nunca em pessoa
 * nem em papel (docs/PLANO.md §13): fixar o endereço da Fernanda significaria
 * que, no dia em que ela sair de férias, ninguém é avisado. Amarrando na
 * permissão, quem entrar no perfil passa a receber sozinho, sem deploy.
 *
 * Isto nasceu dentro de `modules/request.ts` como `findApprovers`, com a chave
 * `request:review` no corpo. O autocadastro precisou da mesma consulta com outra
 * chave (`user:update`), e uma segunda cópia da lógica seria a forma mais fácil
 * de as duas divergirem — a que trata `deny` corretamente e a que esquece.
 */

import type { Permission } from '@acm/shared';

import type { Db } from './prisma';

export interface NotifyRecipient {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/**
 * Usuários ativos cuja permissão efetiva inclui `permission`.
 *
 * Um `deny` explícito no usuário tira ele da lista, seguindo a mesma precedência
 * do RBAC — deny vence, inclusive sobre o que o papel concede (`resolvePermissions`
 * em `@acm/shared`). Sem esse filtro, alguém com o acesso suspenso continuaria
 * recebendo aviso de trabalho que não pode mais fazer.
 */
export async function findUsersWithPermission(
  db: Db,
  permission: Permission,
): Promise<NotifyRecipient[]> {
  const users = await db.user.findMany({
    where: {
      status: 'ativo',
      deletedAt: null,
      role: { permissions: { some: { permission: { key: permission } } } },
    },
    select: {
      id: true,
      email: true,
      name: true,
      permissionOverrides: {
        where: { permission: { key: permission }, effect: 'deny' },
        select: { effect: true },
      },
    },
  });

  return users
    .filter((user) => user.permissionOverrides.length === 0)
    .map((user) => ({ id: user.id, email: user.email, name: user.name }));
}
