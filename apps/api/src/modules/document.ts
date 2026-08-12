/**
 * Documentos de passageiro — DADO SENSÍVEL (LGPD).
 *
 * No protótipo, `pax[].doc` era uma imagem base64 dentro do `localStorage`, e
 * `resizeImage` existia só para caber na cota do navegador. Aqui é arquivo em
 * disco, fora do diretório servido pelo nginx, com quatro travas:
 *
 *   1. MIME e tamanho validados no upload;
 *   2. o nome do arquivo é gerado — nunca o nome enviado pelo usuário;
 *   3. download só por esta rota, autenticada E autorizada por vínculo;
 *   4. `purgeAfter` para expurgo automático pelo job de retenção.
 *
 * O cliente só alcança o documento de passageiro das PRÓPRIAS viagens e
 * solicitações. É verificado por consulta de vínculo, não por confiança no id.
 */

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { documentFileSchema, idParamSchema, type DocumentFile } from '@acm/shared';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import { env } from '../env';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { isClientRole, requireAnyPermission, requireUser } from '../plugins/rbac';
import { getSettings } from './settings';

const UPLOAD_ROOT = resolve(process.cwd(), env.UPLOAD_DIR);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/**
 * Assinaturas de arquivo (magic bytes).
 *
 * O `Content-Type` do multipart é escolhido por quem envia, então confiar nele
 * deixaria passar um executável rotulado como `image/png`. A checagem é no
 * conteúdo real.
 */
function detectMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';

  return null;
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ------------------------------------------------------------------ upload
  route.post(
    '/',
    {
      preValidation: requireAnyPermission('document:create_own', 'document:read'),
      schema: { response: { 201: documentFileSchema } },
      config: { rateLimit: { max: 60, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const user = requireUser(request);

      const file = await request.file();
      if (!file) throw badRequest('Envie um arquivo no campo "file".');

      const buffer = await file.toBuffer();

      if (buffer.length === 0) throw badRequest('O arquivo está vazio.');
      if (buffer.length > env.UPLOAD_MAX_BYTES) {
        throw badRequest(
          `Arquivo muito grande (máximo ${Math.floor(env.UPLOAD_MAX_BYTES / 1024 / 1024)} MB).`,
        );
      }

      const detected = detectMime(buffer);
      if (detected === null) {
        throw badRequest('Formato não reconhecido. Envie JPG, PNG, WEBP ou PDF.');
      }

      const allowed =
        env.UPLOAD_ALLOWED_MIME.length > 0 ? env.UPLOAD_ALLOWED_MIME : Object.keys(EXTENSIONS);
      if (!allowed.includes(detected)) {
        throw badRequest(`Tipo de arquivo não permitido: ${detected}.`);
      }

      const settings = await getSettings();
      const checksum = createHash('sha256').update(buffer).digest('hex');

      // Nome gerado: o nome original nunca toca o sistema de arquivos, então
      // não há caminho para path traversal nem para extensão executável.
      const extension = EXTENSIONS[detected] ?? '.bin';
      const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${extension}`;
      const target = join(UPLOAD_ROOT, storageKey);

      await mkdir(join(UPLOAD_ROOT, storageKey.split('/')[0] ?? ''), { recursive: true });
      await writeFile(target, buffer, { mode: 0o640 });

      try {
        const created = await prisma.documentFile.create({
          data: {
            storageKey,
            originalName: file.filename.slice(0, 255),
            mimeType: detected,
            sizeBytes: buffer.length,
            checksum,
            uploadedById: user.id,
            purgeAfter: new Date(Date.now() + settings.documentRetentionDays * 86_400_000),
          },
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        });

        void reply.status(201);
        const dto: DocumentFile = {
          id: created.id,
          originalName: created.originalName,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes,
          createdAt: created.createdAt.toISOString(),
        };
        return dto;
      } catch (error) {
        // Falhou o registro no banco: remove o arquivo para não deixar órfão.
        await unlink(target).catch(() => undefined);
        throw error;
      }
    },
  );

  // ---------------------------------------------------------------- download
  route.get(
    '/:id',
    {
      preValidation: requireAnyPermission('document:read', 'document:read_own'),
      schema: { params: idParamSchema },
    },
    async (request, reply) => {
      const user = requireUser(request);
      const { id } = request.params;

      const document = await prisma.documentFile.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          originalName: true,
          uploadedById: true,
        },
      });
      if (!document) throw notFound('Documento');

      // O cliente só alcança documento ligado a uma viagem ou solicitação DELE.
      // Verificado por vínculo real, não por adivinhação de id.
      if (isClientRole(user)) {
        const linked = await prisma.passenger.findFirst({
          where: {
            documentFileId: id,
            OR: [
              { trip: { clientId: user.clientId ?? '__never__' } },
              { request: { clientId: user.clientId ?? '__never__' } },
            ],
          },
          select: { id: true },
        });

        // Deixa passar o próprio upload recém-feito, antes de ele ser vinculado
        // a um passageiro — senão a pré-visualização no formulário não funciona.
        if (!linked && document.uploadedById !== user.id) {
          throw forbidden('Este documento não pertence a você.');
        }
      }

      const path = join(UPLOAD_ROOT, document.storageKey);

      try {
        await stat(path);
      } catch {
        throw notFound('Arquivo do documento');
      }

      void reply
        .header('Content-Type', document.mimeType)
        .header('Content-Disposition', `inline; filename="documento-${document.id}"`)
        // Documento de passageiro nunca em cache compartilhado.
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff');

      return reply.send(createReadStream(path));
    },
  );
}
