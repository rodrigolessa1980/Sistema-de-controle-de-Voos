-- Aviso no sino quando alguém se cadastra na tela de login.
--
-- `cadastro_pendente` entra no FIM da lista. MySQL guarda ENUM por posição, e
-- nenhuma linha existente muda quando a lista só cresce no fim — inserir no meio
-- reescreveria o significado dos valores já gravados.

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('solicitacao_nova', 'solicitacao_convertida', 'solicitacao_recusada', 'viagem_agendada', 'viagem_alterada', 'viagem_cancelada', 'cobranca_criada', 'cobranca_vencida', 'pagamento_recebido', 'cadastro_pendente') NOT NULL;
