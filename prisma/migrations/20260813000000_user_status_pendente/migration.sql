-- Autocadastro pela tela de login: a conta nasce `pendente` e só entra depois de
-- o administrador liberar. O DEFAULT continua `ativo` — usuário criado de dentro
-- (seed, portal do cliente) não passa por aprovação.
--
-- `pendente` é o PRIMEIRO valor do ENUM porque é a ordem do enum no schema
-- Prisma, e MySQL guarda a lista posicionalmente. Nenhuma linha existente muda:
-- ampliar a lista de um ENUM não reescreve valor já gravado.

-- AlterTable
ALTER TABLE `users` MODIFY `status` ENUM('pendente', 'ativo', 'inativo', 'bloqueado') NOT NULL DEFAULT 'ativo';
