/**
 * Testes da matriz de autorização.
 *
 * São os três limites que vêm do `HANDOFF.md` original, expressos como
 * invariantes. Se alguém acrescentar uma permissão ao papel errado, o teste
 * quebra antes de o código chegar em produção.
 */

import { describe, expect, it } from 'vitest';

import { ROLE_KEYS } from './enums';
import {
  ALL_PERMISSIONS,
  NAV,
  PERMISSIONS,
  permissionParts,
  resolvePermissions,
  ROLE_PERMISSIONS,
  type Permission,
} from './permissions';

const has = (role: (typeof ROLE_KEYS)[number], permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);

describe('catálogo de permissões', () => {
  it('toda permissão segue o formato recurso:ação', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(key, `"${key}" precisa ter um ":"`).toContain(':');
      const { resource, action } = permissionParts(key);
      expect(resource.length).toBeGreaterThan(0);
      expect(action.length).toBeGreaterThan(0);
    }
  });

  it('toda permissão tem descrição legível', () => {
    for (const key of ALL_PERMISSIONS) {
      expect(PERMISSIONS[key].length, `"${key}" sem descrição`).toBeGreaterThan(3);
    }
  });

  it('nenhum papel referencia permissão inexistente', () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const role of ROLE_KEYS) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} usa "${permission}", que não existe`).toBe(true);
      }
    }
  });

  it('admin tem todas as permissões', () => {
    expect(ROLE_PERMISSIONS.admin).toHaveLength(ALL_PERMISSIONS.length);
  });
});

// ============================================================================
//  OS TRÊS LIMITES DO HANDOFF
// ============================================================================

describe('limite 1 — o Operacional NÃO dá baixa', () => {
  it('não tem nenhuma permissão de pagamento', () => {
    const payments = ALL_PERMISSIONS.filter((p) => p.startsWith('payment:'));
    expect(payments.length).toBeGreaterThan(0);

    for (const permission of payments) {
      expect(has('operacional', permission), `operacional não pode ter ${permission}`).toBe(false);
    }
  });

  it('mas pode LER cobrança, para ver a pendência antes de agendar', () => {
    expect(has('operacional', 'charge:read')).toBe(true);
    expect(has('operacional', 'charge:create')).toBe(false);
  });
});

describe('limite 2 — o Financeiro NÃO altera viagens', () => {
  it('só tem leitura de viagem', () => {
    expect(has('financeiro', 'trip:read')).toBe(true);

    for (const permission of [
      'trip:create',
      'trip:update',
      'trip:cancel',
      'trip:complete',
    ] as const) {
      expect(has('financeiro', permission), `financeiro não pode ter ${permission}`).toBe(false);
    }
  });

  it('não mexe em solicitação nem em frota', () => {
    const forbidden = ALL_PERMISSIONS.filter(
      (p) => p.startsWith('request:') || p.startsWith('aircraft:') || p.startsWith('tariff:'),
    );
    for (const permission of forbidden) {
      expect(has('financeiro', permission), `financeiro não pode ter ${permission}`).toBe(false);
    }
  });

  it('mas dá baixa e estorna — é a função dele', () => {
    expect(has('financeiro', 'payment:settle')).toBe(true);
    expect(has('financeiro', 'payment:reverse')).toBe(true);
    expect(has('financeiro', 'charge:create')).toBe(true);
  });
});

describe('limite 3 — o Cliente só vê o próprio e nunca vê a frota', () => {
  it('não tem NENHUMA permissão de aeronave ou tarifa', () => {
    const fleet = ALL_PERMISSIONS.filter(
      (p) => p.startsWith('aircraft:') || p.startsWith('tariff:'),
    );
    expect(fleet.length).toBeGreaterThan(0);

    for (const permission of fleet) {
      expect(has('cliente', permission), `cliente não pode ter ${permission}`).toBe(false);
    }
  });

  it('só tem permissões com escopo próprio nos recursos compartilhados', () => {
    const scoped = ['client', 'trip', 'request', 'charge', 'document'];

    for (const permission of ROLE_PERMISSIONS.cliente) {
      const { resource, action } = permissionParts(permission);
      if (!scoped.includes(resource)) continue;

      expect(
        action.endsWith('_own'),
        `cliente tem "${permission}" sem escopo _own — vazaria dado de outro cliente`,
      ).toBe(true);
    }
  });

  it('vê disponibilidade apenas mascarada', () => {
    expect(has('cliente', 'availability:read_masked')).toBe(true);
    expect(has('cliente', 'availability:read_full')).toBe(false);
  });

  it('não vê relatório financeiro, usuários nem auditoria', () => {
    for (const permission of [
      'report:financial',
      'user:read',
      'role:read',
      'audit:read',
    ] as const) {
      expect(has('cliente', permission)).toBe(false);
    }
  });

  it('não cria nem edita viagem — quem agenda é a operação', () => {
    expect(has('cliente', 'trip:create')).toBe(false);
    expect(has('cliente', 'trip:update')).toBe(false);
    // Mas solicita, que é o fluxo dele.
    expect(has('cliente', 'request:create_own')).toBe(true);
  });
});

// ============================================================================
//  RESOLUÇÃO DE PERMISSÕES
// ============================================================================

describe('resolvePermissions', () => {
  it('sem override, entrega exatamente as do papel', () => {
    const effective = resolvePermissions('financeiro');
    expect(effective.size).toBe(ROLE_PERMISSIONS.financeiro.length);
    expect(effective.has('payment:settle')).toBe(true);
  });

  it('allow acrescenta uma permissão fora do papel', () => {
    const effective = resolvePermissions('operacional', [
      { permission: 'payment:read', effect: 'allow' },
    ]);
    expect(effective.has('payment:read')).toBe(true);
  });

  it('deny remove uma permissão do papel', () => {
    const effective = resolvePermissions('financeiro', [
      { permission: 'payment:settle', effect: 'deny' },
    ]);
    expect(effective.has('payment:settle')).toBe(false);
  });

  it('deny SEMPRE vence o allow, em qualquer ordem', () => {
    const denyFirst = resolvePermissions('operacional', [
      { permission: 'payment:settle', effect: 'deny' },
      { permission: 'payment:settle', effect: 'allow' },
    ]);
    const allowFirst = resolvePermissions('operacional', [
      { permission: 'payment:settle', effect: 'allow' },
      { permission: 'payment:settle', effect: 'deny' },
    ]);

    expect(denyFirst.has('payment:settle')).toBe(false);
    expect(allowFirst.has('payment:settle')).toBe(false);
  });
});

describe('navegação', () => {
  it('todo item de menu exige uma permissão que o papel realmente tem', () => {
    for (const role of ROLE_KEYS) {
      for (const item of NAV[role]) {
        expect(
          ROLE_PERMISSIONS[role].includes(item.permission),
          `${role}: o menu "${item.label}" exige "${item.permission}", que o papel não tem`,
        ).toBe(true);
      }
    }
  });

  it('o cliente não tem nenhum item apontando para área interna', () => {
    for (const item of NAV.cliente) {
      expect(item.path.startsWith('/cliente')).toBe(true);
    }
  });
});
