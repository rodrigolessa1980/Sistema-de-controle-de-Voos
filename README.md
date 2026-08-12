# Air Charter Manager — Protótipo (Frontend)

Sistema de gestão de táxi aéreo. **Protótipo somente frontend**, com dados
**mockados** persistidos no `localStorage` do navegador. Não há backend, banco
de dados nem API — isso será conectado pelo desenvolvedor (ver `HANDOFF.md`).

## O que tem aqui

```
src/index.html                 → CÓDIGO-FONTE editável (React + Tailwind via CDN,
                                  JSX compilado no navegador pelo Babel standalone).
                                  É AQUI que se edita a aplicação.
dist/air-charter-manager.html  → Versão "pronta" e autossuficiente (React, Tailwind,
                                  ícones e JS já embutidos). Abre offline com 2 cliques.
                                  Boa para demonstração; é um artefato gerado.
build/                         → Pipeline opcional para gerar a versão dist a partir
                                  do src (Tailwind CLI + esbuild + assemble.mjs).
HANDOFF.md                     → Guia técnico para conectar o banco de dados.
```

## Como rodar (para ver funcionando)

Basta abrir **`dist/air-charter-manager.html`** no navegador (duplo clique) —
funciona offline. Para desenvolver, sirva a pasta `src/` com qualquer servidor
estático, por exemplo:

```bash
npx serve src        # ou: python3 -m http.server -d src 8080
# abra http://localhost:3000 (ou :8080)
```

> `src/index.html` usa CDNs (React, Babel, Tailwind, Lucide), então precisa de
> internet no modo desenvolvimento. A versão `dist/` não precisa.

## Perfis (protótipo, sem login real)

Na tela de login clique em **Entrar**. No topo, use **"Visualizar como"** para
alternar entre **Operacional**, **Financeiro** e **Cliente**.

## Resetar os dados de demonstração

Os dados ficam em `localStorage` (chave `acm-html-v4`). Limpe o armazenamento do
site no navegador para voltar ao estado inicial.

## Stack sugerida para a evolução

Migrar esta UI para um app **React/Next.js + TypeScript** e conectar a um backend
com **API REST/GraphQL + Prisma + PostgreSQL**. Ver `HANDOFF.md` para o mapa de
dados e onde trocar o `localStorage` por chamadas de API.
