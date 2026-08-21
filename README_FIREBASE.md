# Mambemba Business — Firebase

Esta versão liga o painel ao projeto Firebase `mambemba-business-d83d0`.

## O que foi ligado
- Firebase Authentication (utilizador + palavra-passe)
- Cloud Firestore para sincronização dos dados do painel
- Firebase Storage para fotos de produtos
- Menu ⚙️ Definições mantido
- Equipa/Financeiro/Encomendas continuam com a interface existente

## Primeiro acesso
O utilizador `Admin` com a palavra-passe `03052000` é usado para fazer o bootstrap da primeira conta Firebase. Depois, altere a palavra-passe e crie utilizadores individuais na área Equipa.

## Firebase Console
Ative:
1. Authentication → Sign-in method → Email/Password
2. Firestore Database → Create database
3. Storage → Get started

Publique as regras dos ficheiros `firestore.rules` e `storage.rules`.

## Importante sobre permissões
A interface continua a aplicar os perfis Admin, Gestor, Vendedor, Entregador e Financeiro. Para segurança empresarial completa, as regras Firestore devem ser refinadas para cada operação/campo conforme a política da equipa. Não confie apenas em botões escondidos no navegador.

## Definições
O menu ⚙️ Definições continua disponível e permite alterar nome/slogan e fazer backup/importação local.
