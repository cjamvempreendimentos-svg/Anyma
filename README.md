# Anyma

Sistema de gestão para lojas desenvolvido pela Camacho Tecnologia.

## Núcleo atual

- autenticação por e-mail e senha;
- criação automática da primeira loja para o proprietário;
- isolamento por loja com RLS em todas as tabelas públicas;
- cadastro de produtos com estoque inicial auditado;
- ajustes de estoque com histórico de movimentações;
- PDV com venda transacional e baixa persistente de estoque;
- painel, caixa e relatórios usando dados reais da loja.

## Executar

```bash
npm install
npm run dev
```

## Validar

```bash
npm test
npm run build
```

## Publicação

O repositório está vinculado ao Netlify. Alterações em branches de pull request devem gerar Deploy Previews para validação antes do merge.

## Configuração

Copie `.env.example` para `.env` e preencha somente a URL e a chave publicável do projeto Supabase. Nunca use uma chave `service_role` no frontend.

O schema versionado está em `supabase/migrations`. As variáveis do Deploy Preview são configuradas no Netlify, fora do repositório.
