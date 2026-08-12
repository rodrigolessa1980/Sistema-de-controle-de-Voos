/**
 * Passageiros e documentos — protótipo: `PassengersEditor`, `PaxList`,
 * `GlobalDocViewer` e `resizeImage`.
 *
 * A grande diferença: no protótipo a foto virava base64 dentro do
 * `localStorage`, e `resizeImage` existia só para caber na cota do navegador.
 * Agora o arquivo sobe para o servidor e fica fora do diretório público; o
 * componente guarda apenas o `documentFileId`.
 *
 * A visualização passa pela rota autenticada — por isso `useDocumentUrl` busca
 * com o token e cria um object URL, em vez de apontar `<img src>` para a API.
 */

import type { DocumentFile, Passenger, PassengerInputBody } from '@acm/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import { api, fetchDocumentBlob } from '../lib/api';
import { useFeedback } from '../lib/feedback';
import { Btn, Field, Icon, Input, Modal, Spinner } from './ui';

export interface PassengerDraft {
  readonly key: string;
  name: string;
  documentFileId: string | null;
  uploading: boolean;
}

export const newPassenger = (): PassengerDraft => ({
  key: `px-${Math.random().toString(36).slice(2, 10)}`,
  name: '',
  documentFileId: null,
  uploading: false,
});

export const toPassengerBody = (list: readonly PassengerDraft[]): PassengerInputBody[] =>
  list.map((p) => ({ name: p.name.trim(), documentFileId: p.documentFileId }));

/** Object URL de um documento, revogado ao desmontar para não vazar memória. */
export function useDocumentUrl(documentFileId: string | null): {
  url: string | null;
  loading: boolean;
} {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (documentFileId === null) {
      setUrl(null);
      return;
    }

    let revoked: string | null = null;
    let cancelled = false;
    setLoading(true);

    fetchDocumentBlob(documentFileId)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revoked = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (revoked !== null) URL.revokeObjectURL(revoked);
    };
  }, [documentFileId]);

  return { url, loading };
}

function DocumentThumb({
  documentFileId,
  onOpen,
}: {
  documentFileId: string;
  onOpen: (id: string) => void;
}): JSX.Element {
  const { url, loading } = useDocumentUrl(documentFileId);

  if (loading) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-line text-sub">
        <Spinner />
      </div>
    );
  }

  if (url === null) {
    return (
      <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-line text-sub">
        <Icon name="ImageOff" size={16} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt="Documento do passageiro"
      onClick={() => {
        onOpen(documentFileId);
      }}
      className="h-14 w-20 cursor-pointer rounded-md border border-line object-cover"
    />
  );
}

/** Lightbox — protótipo: `GlobalDocViewer`. */
export function DocumentViewer({
  documentFileId,
  onClose,
}: {
  documentFileId: string | null;
  onClose: () => void;
}): JSX.Element | null {
  const { url, loading } = useDocumentUrl(documentFileId);
  if (documentFileId === null) return null;

  return (
    <Modal
      open
      onClose={onClose}
      size="max-w-2xl"
      title="Documento do passageiro"
      desc="Documento com foto enviado na solicitação."
    >
      {loading ? (
        <div className="flex justify-center py-14">
          <Spinner />
        </div>
      ) : url === null ? (
        <p className="py-10 text-center text-sm text-sub">Não foi possível carregar o documento.</p>
      ) : (
        <img
          src={url}
          alt="Documento do passageiro"
          className="mx-auto max-h-[68vh] w-auto rounded-lg border border-line"
        />
      )}
    </Modal>
  );
}

export function PassengersEditor({
  value,
  onChange,
  requireDocument,
}: {
  value: readonly PassengerDraft[];
  onChange: (list: PassengerDraft[]) => void;
  requireDocument: boolean;
}): JSX.Element {
  const { notifyError } = useFeedback();
  const [viewing, setViewing] = useState<string | null>(null);

  const update = (key: string, patch: Partial<PassengerDraft>): void => {
    onChange(value.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const upload = async (key: string, file: File | undefined): Promise<void> => {
    if (!file) return;
    update(key, { uploading: true });
    try {
      const uploaded = await api.upload<DocumentFile>('/documents', file);
      update(key, { documentFileId: uploaded.id, uploading: false });
    } catch (error) {
      update(key, { uploading: false });
      notifyError(error, 'Não foi possível enviar o documento.');
    }
  };

  return (
    <div className="space-y-3">
      {value.map((passenger, index) => (
        <div key={passenger.key} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sub">
              <Icon name="User" size={14} /> Passageiro {index + 1}
            </span>
            {value.length > 1 && (
              <button
                type="button"
                aria-label="Remover passageiro"
                onClick={() => {
                  onChange(value.filter((p) => p.key !== passenger.key));
                }}
                className="text-sub hover:text-danger"
              >
                <Icon name="Trash2" size={15} />
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome completo" required help="Nome exatamente como está no documento.">
              <Input
                value={passenger.name}
                onChange={(e) => {
                  update(passenger.key, { name: e.target.value });
                }}
                placeholder="Nome do passageiro"
              />
            </Field>

            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <label className="text-sm font-medium text-ink">
                  Documento com foto
                  {requireDocument && <span className="ml-0.5 text-danger">*</span>}
                </label>
                <span
                  data-help
                  title="Envie a foto de um documento com foto (RG, CNH ou passaporte)."
                  className="text-sub/70"
                >
                  <Icon name="HelpCircle" size={14} />
                </span>
              </div>

              {passenger.uploading ? (
                <div className="flex h-14 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-soft/50 text-xs text-sub">
                  <Spinner /> Enviando…
                </div>
              ) : passenger.documentFileId !== null ? (
                <div className="flex items-center gap-2">
                  <DocumentThumb documentFileId={passenger.documentFileId} onOpen={setViewing} />
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setViewing(passenger.documentFileId);
                      }}
                      className="text-left text-xs text-primary hover:underline"
                    >
                      Ver
                    </button>
                    <label className="cursor-pointer text-xs text-primary hover:underline">
                      Trocar
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          void upload(passenger.key, e.target.files?.[0]);
                        }}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <label className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-soft/50 text-xs font-medium text-sub hover:bg-soft">
                  <Icon name="Camera" size={16} /> Enviar foto do documento
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      void upload(passenger.key, e.target.files?.[0]);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </div>
      ))}

      <Btn
        variant="outline"
        size="sm"
        onClick={() => {
          onChange([...value, newPassenger()]);
        }}
      >
        <Icon name="UserPlus" size={16} /> Adicionar passageiro
      </Btn>

      <DocumentViewer
        documentFileId={viewing}
        onClose={() => {
          setViewing(null);
        }}
      />
    </div>
  );
}

/** Lista somente-leitura — protótipo: `PaxList`. */
export function PassengerList({ pax }: { pax: readonly Passenger[] }): JSX.Element | null {
  const [viewing, setViewing] = useState<string | null>(null);
  if (pax.length === 0) return null;

  return (
    <div className="space-y-2">
      {pax.map((passenger, index) => (
        <div
          key={passenger.id}
          className="flex items-center gap-3 rounded-lg border border-line p-2.5"
        >
          {passenger.documentFileId !== null ? (
            <DocumentThumb documentFileId={passenger.documentFileId} onOpen={setViewing} />
          ) : (
            <div className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-line text-sub">
              <Icon name="ImageOff" size={16} />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">
              {passenger.name === '' ? `Passageiro ${index + 1}` : passenger.name}
            </p>
            <p className="text-xs text-sub">
              {passenger.hasDocument ? 'Documento anexado' : 'Sem documento'}
            </p>
          </div>
          {passenger.documentFileId !== null && (
            <button
              type="button"
              onClick={() => {
                setViewing(passenger.documentFileId);
              }}
              className="ml-auto whitespace-nowrap text-xs text-primary hover:underline"
            >
              Ver documento
            </button>
          )}
        </div>
      ))}

      <DocumentViewer
        documentFileId={viewing}
        onClose={() => {
          setViewing(null);
        }}
      />
    </div>
  );
}
