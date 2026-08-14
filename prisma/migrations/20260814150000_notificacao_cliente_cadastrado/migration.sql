-- O autocadastro deixou de ter fila de liberação: quem se cadastra entra na hora
-- como Cliente. O aviso ao administrador virou notícia, não trabalho pendente, e
-- por isso ganhou valor próprio em vez de reaproveitar `cadastro_pendente` — um
-- nome que mente sobre o que aconteceu é pior que uma coluna a mais.
--
-- `cadastro_pendente` FICA: existem avisos gravados com ele, e as contas que já
-- estavam na fila continuam válidas até serem resolvidas.
--
-- Valor novo no FIM da lista. MySQL guarda ENUM por posição: crescer no fim não
-- reescreve nada já gravado; inserir no meio trocaria o significado das linhas
-- existentes.
--
-- Esta migration sobe JUNTO com o código que conhece o valor, pela mesma imagem,
-- aplicada no entrypoint da API. Aplicá-la antes — direto no banco, pela máquina
-- de quem desenvolve — foi o que derrubou `GET /api/notifications` por 24 horas
-- em 13/08 (docs/DEPLOY.md §5).

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('solicitacao_nova', 'solicitacao_convertida', 'solicitacao_recusada', 'viagem_agendada', 'viagem_alterada', 'viagem_cancelada', 'cobranca_criada', 'cobranca_vencida', 'pagamento_recebido', 'cadastro_pendente', 'cliente_cadastrado') NOT NULL;
