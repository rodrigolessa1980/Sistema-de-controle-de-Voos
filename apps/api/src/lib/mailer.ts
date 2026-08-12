/**
 * Fila de e-mail (padrão outbox) e templates.
 *
 * Nada aqui envia e-mail de forma síncrona. `enqueueEmail` grava uma linha
 * DENTRO da transação de quem chama; o worker `jobs/email-outbox.ts` entrega
 * depois, com retry e backoff.
 *
 * Sem isso, duas coisas dão errado (docs/PLANO.md §13.2):
 *   - enviar dentro da transação → rollback deixa um aviso de solicitação que
 *     não existe;
 *   - enviar depois da transação → SMTP fora do ar perde o aviso em silêncio.
 */

import { formatDateTime } from '@acm/shared';

import { env, mailIsDryRun } from '../env';
import type { Db } from './prisma';

export interface EmailTemplateData {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface EnqueueEmailInput {
  /**
   * Chave de idempotência, ex.: `request.created:<id>`.
   *
   * O índice único no banco é o que garante que um retry do worker, um duplo
   * clique ou dois processos concorrentes não gerem um segundo e-mail.
   */
  readonly dedupeKey: string;
  readonly recipients: readonly string[];
  readonly subject: string;
  readonly template: TemplateName;
  readonly payload: Record<string, unknown>;
  readonly replyTo?: string | undefined;
}

/**
 * Enfileira. Chame com o `tx` da transação que produziu o fato.
 *
 * Colisão de `dedupeKey` é ignorada em silêncio — significa que o aviso já foi
 * enfileirado, que é exatamente o resultado desejado.
 */
export async function enqueueEmail(tx: Db, input: EnqueueEmailInput): Promise<void> {
  const recipients = [...new Set(input.recipients.map((r) => r.trim().toLowerCase()))].filter(
    (r) => r.length > 0 && r.includes('@'),
  );

  if (recipients.length === 0) return;

  await tx.emailOutbox.createMany({
    data: [
      {
        dedupeKey: input.dedupeKey,
        recipients: recipients.join(','),
        subject: input.subject,
        template: input.template,
        payload: input.payload as never,
        // MAIL_REPLY_TO tem default no schema do env: string vazia vira null aqui.
        replyTo: input.replyTo ?? (env.MAIL_REPLY_TO === '' ? null : env.MAIL_REPLY_TO),
      },
    ],
    skipDuplicates: true,
  });
}

// ============================================================================
//  TEMPLATES
// ============================================================================

export type TemplateName = 'solicitacao-nova' | 'senha-provisoria' | 'cobranca-vencendo';

const shell = (title: string, body: string): string => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F7F9FC;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#26303D">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px">
    <div style="font-size:15px;font-weight:600;color:#446A8D;margin-bottom:20px">
      ${escapeHtml(env.MAIL_FROM_NAME)}
    </div>
    <div style="background:#fff;border:1px solid #DDE3EC;border-radius:12px;padding:24px">
      ${body}
    </div>
    <p style="margin-top:20px;font-size:12px;color:#6B7688;line-height:1.6">
      Este é um aviso automático — não responda a esta mensagem.
    </p>
  </div>
</body></html>`;

const button = (href: string, label: string): string =>
  `<a href="${escapeHtml(href)}" style="display:inline-block;background:#446A8D;color:#fff;` +
  `text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">` +
  `${escapeHtml(label)}</a>`;

const row = (label: string, value: string): string =>
  `<tr>
     <td style="padding:6px 0;font-size:13px;color:#6B7688;width:130px">${escapeHtml(label)}</td>
     <td style="padding:6px 0;font-size:14px;font-weight:500">${escapeHtml(value)}</td>
   </tr>`;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Leitura tolerante do JSON do payload — o worker não pode quebrar por um campo. */
function str(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
}

/**
 * Renderiza o template.
 *
 * REGRA: nenhum template carrega documento de passageiro. O e-mail leva o
 * resumo e um link; o documento só é visto na rota autenticada (LGPD).
 */
export function renderTemplate(
  template: TemplateName,
  payload: Record<string, unknown>,
): EmailTemplateData {
  switch (template) {
    case 'solicitacao-nova': {
      const code = str(payload, 'code');
      const client = str(payload, 'clientName');
      const origin = str(payload, 'origin');
      const destination = str(payload, 'destination');
      const departureAt = str(payload, 'departureAt');
      const returnAt = str(payload, 'returnAt');
      const passengers = str(payload, 'passengers', '0');
      const notes = str(payload, 'notes');
      const link = str(payload, 'link');

      const subject = `Nova solicitação de voo ${code} — aprovação pendente`;

      const html = shell(
        subject,
        `<h1 style="margin:0 0 6px;font-size:19px">Nova solicitação de voo</h1>
         <p style="margin:0 0 18px;font-size:14px;color:#6B7688">
           ${escapeHtml(client)} enviou a solicitação <strong>${escapeHtml(code)}</strong> e ela
           está aguardando análise.
         </p>
         <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
           ${row('Trajeto', `${origin} → ${destination}`)}
           ${row('Ida', departureAt)}
           ${row('Volta', returnAt)}
           ${row('Passageiros', passengers)}
           ${notes ? row('Observações', notes) : ''}
         </table>
         ${link ? button(link, 'Analisar solicitação') : ''}`,
      );

      const text = [
        `Nova solicitação de voo ${code}`,
        `Cliente: ${client}`,
        `Trajeto: ${origin} -> ${destination}`,
        `Ida: ${departureAt}`,
        `Volta: ${returnAt}`,
        `Passageiros: ${passengers}`,
        notes ? `Observações: ${notes}` : '',
        link ? `Analisar: ${link}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return { subject, html, text };
    }

    case 'senha-provisoria': {
      const name = str(payload, 'name');
      const email = str(payload, 'email');
      const password = str(payload, 'password');
      const link = str(payload, 'link');

      const subject = 'Seu acesso ao Air Charter Manager';

      const html = shell(
        subject,
        `<h1 style="margin:0 0 6px;font-size:19px">Bem-vindo, ${escapeHtml(name)}</h1>
         <p style="margin:0 0 18px;font-size:14px;color:#6B7688">
           Criamos o seu acesso ao portal. Use a senha provisória abaixo — o sistema vai
           pedir para você trocá-la no primeiro acesso.
         </p>
         <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
           ${row('E-mail', email)}
           ${row('Senha provisória', password)}
         </table>
         ${link ? button(link, 'Acessar o portal') : ''}
         <p style="margin:18px 0 0;font-size:12px;color:#6B7688">
           Se você não esperava este e-mail, ignore-o e avise a nossa operação.
         </p>`,
      );

      const text = [
        `Bem-vindo, ${name}`,
        `E-mail: ${email}`,
        `Senha provisória: ${password}`,
        link ? `Acesse: ${link}` : '',
        'Troque a senha no primeiro acesso.',
      ]
        .filter(Boolean)
        .join('\n');

      return { subject, html, text };
    }

    case 'cobranca-vencendo': {
      const code = str(payload, 'code');
      const client = str(payload, 'clientName');
      const amount = str(payload, 'amount');
      const dueDate = str(payload, 'dueDate');
      const link = str(payload, 'link');

      const subject = `Cobrança ${code} vence em breve`;

      const html = shell(
        subject,
        `<h1 style="margin:0 0 6px;font-size:19px">Cobrança a vencer</h1>
         <p style="margin:0 0 18px;font-size:14px;color:#6B7688">
           Olá, ${escapeHtml(client)}. A cobrança <strong>${escapeHtml(code)}</strong> está
           próxima do vencimento.
         </p>
         <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
           ${row('Valor em aberto', amount)}
           ${row('Vencimento', dueDate)}
         </table>
         ${link ? button(link, 'Ver no portal') : ''}`,
      );

      const text = [
        `Cobrança ${code} vence em ${dueDate}`,
        `Cliente: ${client}`,
        `Valor em aberto: ${amount}`,
        link ? `Ver: ${link}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return { subject, html, text };
    }

    default: {
      const exhaustive: never = template;
      throw new Error(`Template desconhecido: ${String(exhaustive)}`);
    }
  }
}

// ============================================================================
//  ENTREGA
// ============================================================================

export interface SendResult {
  readonly ok: boolean;
  readonly providerMessageId?: string | undefined;
  readonly error?: string | undefined;
}

/**
 * Entrega de fato ao provedor.
 *
 * Enquanto não houver provedor contratado (`MAIL_API_KEY` vazia), roda em
 * dry-run: registra o que seria enviado e devolve sucesso, para que a fila não
 * acumule falha por uma decisão que ainda não foi tomada (docs/PLANO.md §13.3).
 */
export async function deliver(
  recipients: readonly string[],
  data: EmailTemplateData,
  replyTo: string | null,
): Promise<SendResult> {
  if (mailIsDryRun) {
    return { ok: true, providerMessageId: `dry-run:${Date.now().toString(36)}` };
  }

  const from = `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`;

  try {
    switch (env.MAIL_PROVIDER) {
      case 'resend': {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.MAIL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from,
            to: [...recipients],
            subject: data.subject,
            html: data.html,
            text: data.text,
            ...(replyTo ? { reply_to: replyTo } : {}),
          }),
        });

        if (!response.ok) {
          return { ok: false, error: `resend ${response.status}: ${await response.text()}` };
        }

        const body = (await response.json()) as { id?: string };
        return { ok: true, providerMessageId: body.id ?? undefined };
      }

      case 'sendgrid': {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.MAIL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: recipients.map((email) => ({ email })) }],
            from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
            subject: data.subject,
            content: [
              { type: 'text/plain', value: data.text },
              { type: 'text/html', value: data.html },
            ],
            ...(replyTo ? { reply_to: { email: replyTo } } : {}),
          }),
        });

        if (!response.ok) {
          return { ok: false, error: `sendgrid ${response.status}: ${await response.text()}` };
        }
        return { ok: true, providerMessageId: response.headers.get('x-message-id') ?? undefined };
      }

      case 'ses':
        // SES exige assinatura SigV4; entra junto com a escolha do provedor.
        return { ok: false, error: 'Provedor SES ainda não implementado.' };

      case 'console':
        return { ok: true, providerMessageId: 'console' };

      default: {
        const exhaustive: never = env.MAIL_PROVIDER;
        return { ok: false, error: `Provedor desconhecido: ${String(exhaustive)}` };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Backoff exponencial: 1min, 4min, 15min, 1h, 4h. */
export function nextAttemptDelayMs(attempts: number): number {
  const minutes = [1, 4, 15, 60, 240];
  const idx = Math.min(attempts, minutes.length - 1);
  return (minutes[idx] ?? 240) * 60_000;
}

/** Payload legível do aviso de solicitação — sem nenhum dado sensível. */
export function requestEmailPayload(input: {
  code: string;
  clientName: string;
  origin: string;
  destination: string;
  departureAt: Date;
  returnAt: Date;
  passengers: number;
  notes: string | null;
  requestId: string;
}): Record<string, unknown> {
  return {
    code: input.code,
    clientName: input.clientName,
    origin: input.origin,
    destination: input.destination,
    departureAt: formatDateTime(input.departureAt),
    returnAt: formatDateTime(input.returnAt),
    passengers: input.passengers,
    notes: input.notes ?? '',
    link: `${env.WEB_BASE_URL}/operacional/solicitacoes?id=${input.requestId}`,
  };
}
