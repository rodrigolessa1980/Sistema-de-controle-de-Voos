-- Custos da viagem lançados no formulário "Nova viagem". Todos opcionais, em R$.
-- Somados no painel do Financeiro.
--
-- Sobe junto com o código, pelo entrypoint da API (docs/DEPLOY.md §5).

-- AlterTable
ALTER TABLE `trips`
    ADD COLUMN `cost_fuel` DECIMAL(14, 2) NULL,
    ADD COLUMN `cost_flight_hour` DECIMAL(14, 2) NULL,
    ADD COLUMN `cost_pilot` DECIMAL(14, 2) NULL,
    ADD COLUMN `cost_fees` DECIMAL(14, 2) NULL,
    ADD COLUMN `cost_internet` DECIMAL(14, 2) NULL;
