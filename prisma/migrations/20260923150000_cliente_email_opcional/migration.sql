-- E-mail do cliente deixou de ser obrigatório no cadastro. Só é exigido quando
-- o cliente ganha acesso ao portal, porque aí ele é o login.
--
-- O índice UNIQUE continua: no MySQL, várias linhas com NULL não colidem.
--
-- Sobe junto com o código, pelo entrypoint da API (docs/DEPLOY.md §5).

-- AlterTable
ALTER TABLE `clients` MODIFY `email` VARCHAR(190) NULL;
