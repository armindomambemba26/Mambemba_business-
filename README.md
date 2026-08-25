# MAMBEMBA BUSINESS — v3.3 (GitHub Pages + Firebase)

Sistema de gestão de encomendas, clientes, equipa e financeiro da **Mambemba Business**,
com o site publicado gratuitamente no **GitHub Pages** e os dados sincronizados entre
todos os dispositivos da equipa através do **Firebase** (Authentication + Firestore),
continuando sem servidor próprio e sem custos.

> **Cuidamos do teu estilo.**

---

## 1. O que esta versão é (e o que não é)

- ✅ HTML5 + CSS3 + JavaScript puro (Vanilla JS). Sem Node.js, sem PHP, sem frameworks de backend próprios.
- ✅ **Login real por conta:** cada pessoa da equipa entra com o seu e-mail e palavra-passe
  (Firebase Authentication). Não há palavras-passe partilhadas nem guardadas no código.
- ✅ **Encomendas, clientes e definições** ficam no **Cloud Firestore**, sincronizados em
  tempo real — o que um vendedor cria num telemóvel aparece automaticamente nos outros.
- ✅ **Fotos dos produtos** também ficam no **Cloud Firestore** (coleção `photos`), como
  imagem comprimida — em vez do Firebase Storage, porque a Google passou a exigir o
  plano pago Blaze só para usar o Storage. O Firestore continua 100% gratuito no plano
  Spark, por isso a app não exige cartão de crédito nenhum.
- ✅ Continua a funcionar 100% no GitHub Pages, sem `npm install`, sem servidor próprio —
  o "backend" é inteiramente gerido pelo Firebase (plano gratuito Spark cobre uma loja
  deste porte com folga).
- ⚠️ **Não existe pasta `backend/`**, mas os dados deixam de ser só locais: qualquer
  pessoa com uma conta ativa na coleção `team` consegue lê-los, de qualquer aparelho.

  Isso é o que permite a sincronização — e é por isso que as regras de segurança
  (`firestore.rules` e `storage.rules`, secção 4) são obrigatórias, não opcionais.
- ⚠️ A validação pública de recibo por QR Code (abrir o link sem sessão iniciada) deixa
  de funcionar nesta versão, porque os dados agora exigem autenticação. Um funcionário
  com sessão iniciada continua a conseguir validar qualquer recibo normalmente.

---

## 2. Acesso inicial

Não existe utilizador pré-definido nesta versão — a primeira conta Admin tem de ser
criada manualmente uma única vez (ver secção 4.4 abaixo). Depois disso, o próprio Admin
cria os restantes utilizadores dentro da app, em **Equipa → Novo utilizador**.

### Funções e permissões

| Função | Acesso |
|---|---|
| Admin | Total (painel, encomendas, clientes, equipa, financeiro) |
| Gestor | Painel, encomendas, clientes, equipa, financeiro |
| Vendedor | Painel, encomendas, clientes |
| Entregador | Painel, encomendas |
| Financeiro | Painel, financeiro |

---

## 3. Como configurar o Firebase (fazer uma vez, antes de publicar)

O projeto Firebase já existe (`mambemba-business-eceb9`) e a configuração já está no
ficheiro `firebase-config.js`. Falta ativar 2 serviços e aplicar as regras de segurança
— **não é preciso Storage nem cartão de crédito**, tudo corre no plano gratuito Spark.

### 3.1 Ativar Authentication
1. Abra o [Firebase Console](https://console.firebase.google.com/) → projeto `mambemba-business-eceb9`.
2. **Build → Authentication → Get started**.
3. Na aba **Sign-in method**, ative o fornecedor **Email/Password**.

### 3.2 Ativar Firestore e aplicar as regras
1. **Build → Firestore Database → Create database**.
2. Escolha uma localização (ex.: `eur3` ou a mais próxima) e modo **produção**.
3. Vá à aba **Rules**, apague o conteúdo e cole o ficheiro `firestore.rules` deste
   pacote → **Publish**.

### 3.3 Criar a primeira conta Admin (manual, só na primeira vez)
1. **Authentication → Users → Add user** → introduza o seu e-mail e uma palavra-passe
   → **Add user**.
2. Copie o **User UID** gerado (aparece na lista de utilizadores).
3. **Firestore Database → Start collection** → ID da coleção: `team`.
4. ID do documento: **cole o UID copiado no passo 2** (não deixe ser automático).
5. Adicione os campos:
   - `nome` (string) → o seu nome
   - `email` (string) → o mesmo e-mail do passo 1
   - `funcao` (string) → `Admin`
   - `estado` (string) → `Ativo`
6. Guarde. Já pode iniciar sessão na app com esse e-mail e palavra-passe.

A partir daqui, todos os outros utilizadores (Gestor, Vendedor, Entregador, Financeiro)
são criados diretamente dentro da app pelo Admin, em **Equipa → Novo utilizador** — a
pessoa recebe um e-mail do Firebase para definir a sua própria palavra-passe.

---

## 4. Como publicar no GitHub Pages (passo a passo)

1. Crie um repositório novo no GitHub (pode ser público ou privado, desde que o
   plano suporte Pages em privado).
2. Envie **todos os ficheiros deste ZIP** para a raiz do repositório
   (`index.html`, `style.css`, `app.js`, `qrcode.js`, `manifest.json`, `README.md`).
   - No telemóvel: abra o repositório no site do GitHub → **Add file** → **Upload files**
     → selecione os ficheiros → **Commit changes**.
3. Vá a **Settings** (Definições) do repositório.
4. Vá a **Pages** no menu lateral.
5. Em **Build and deployment**, escolha **Deploy from a branch**.
6. Em **Branch**, escolha **main** (ou a branch onde enviou os ficheiros).
7. Escolha a pasta **/(root)**.
8. Clique em **Save**.
9. Aguarde 1–2 minutos e abra o link gerado (algo como
   `https://SEU-UTILIZADOR.github.io/NOME-DO-REPOSITORIO/`).

O sistema deve abrir diretamente na tela de login.

---

## 5. Estrutura de ficheiros

```
index.html         → estrutura de toda a aplicação (login, painel, modais)
style.css          → identidade visual e responsividade
firebase-config.js → ligação ao projeto Firebase (chaves públicas do cliente)
app.js             → toda a lógica: autenticação, encomendas, clientes, equipa,
                     financeiro, recibo A4, partilha, pesquisa
qrcode.js          → gerador de QR Code local (sem internet, sem API externa)
manifest.json      → permite "instalar" o painel no ecrã inicial do telemóvel
firestore.rules    → regras de segurança do Firestore (colar na consola Firebase)
README.md          → este ficheiro
```

Não existe pasta `backend/`, nem servidor próprio, nem `npm install`/Node.js — mas
o armazenamento e a autenticação já não são só locais: passam pelo Firebase (Google),
que faz o papel de backend gerido. As chaves em `firebase-config.js` são públicas por
natureza (é assim que toda a app Firebase do lado do cliente funciona); quem protege os
dados são as regras em `firestore.rules`/`storage.rules`, não o segredo dessas chaves.

---

## 6. Funcionalidades incluídas

- **Login/Sessão:** validação real de utilizador e palavra-passe, sessão guardada em
  LocalStorage, sessão mantida ao atualizar a página, botão **Sair** com confirmação,
  bloqueio do painel sem sessão válida (inclusive pelo botão "voltar" do navegador).
- **Painel principal:** contadores de encomendas, entregues, pendentes, produtos e total,
  mais a lista de "Entregas do dia".
- **Encomendas:** criar, editar, pesquisar em tempo real, filtrar por estado, marcar como
  entregue, reabrir, eliminar (com confirmação), ver e partilhar recibo. A lista aparece
  **agrupada por dia**, com cabeçalho de data e contagem de encomendas por dia. Cor,
  tamanho e foto do produto são obrigatórios — exceto cor/tamanho quando a categoria é
  "Perfume".
- **Foto do produto:** seleção da galeria/câmara do telemóvel, pré-visualização, e
  guardada no IndexedDB — continua disponível depois de atualizar a página.
- **Clientes:** tabela criada/atualizada automaticamente a partir das encomendas
  (nome, contacto, nº de compras, autorização para novidades).
- **Equipa:** gestão de utilizadores por função, com permissões aplicadas no ecrã.
- **Financeiro:** total geral, total de produtos, total de táxis e nº de encomendas,
  calculados automaticamente a partir dos dados reais.
- **Definições:** editar o nome/slogan da loja, **exportar/importar uma cópia de
  segurança completa** (encomendas, clientes, equipa e fotos) em ficheiro `.json`, e
  apagar todos os dados do dispositivo quando necessário.
- **Recibo A4:** pronto para impressão via `window.print()`, com QR Code de validação
  local gerado no próprio navegador (sem serviço externo) e legenda simples
  "Aponte a câmera" por baixo do código.
- **Partilha:** o recibo é gerado em **PDF diretamente no navegador** (sem serviço
  externo) e enviado através da folha de partilha nativa do telemóvel — a única forma
  de um site anexar um ficheiro ao WhatsApp ou ao E-mail sem um servidor. Ao tocar em
  WhatsApp ou E-mail, o telemóvel abre o menu de partilha com o PDF já pronto; basta
  escolher a app. A opção SMS continua a enviar apenas o texto do recibo (o protocolo
  SMS não suporta anexos). Em navegadores mais antigos que não suportem partilha de
  ficheiros, o PDF é descarregado automaticamente para anexar manualmente.

---

## 7. Notas para o crescimento futuro

Esta versão já resolve a sincronização entre dispositivos através do Firebase
(Authentication + Firestore), sem precisar de um servidor próprio nem de cartão de
crédito associado. Ideias para continuar a evoluir, quando fizer sentido para o negócio:

- **Fotos e o plano Blaze:** as fotos ficam em Firestore (comprimidas) em vez do Firebase
  Storage, porque o Storage passou a exigir o plano pago Blaze. Se um dia a loja quiser
  fotos em maior qualidade/resolução, ou passar a guardar vídeos, vale a pena reconsiderar
  o Blaze — o volume de uma loja deste porte tende a ficar dentro da faixa gratuita do
  próprio Blaze (paga-se só o que ultrapassar), mas isso exige associar um cartão.

- **Validação pública de recibo sem login:** hoje, abrir o link do QR code sem sessão
  iniciada não mostra os dados (as regras de segurança exigem autenticação). Para
  reativar isso de forma segura, o caminho normal é uma Cloud Function pequena que
  exponha só os campos do recibo (sem dados sensíveis do cliente) a pedidos públicos —
  isso já seria um mini-backend gerido pelo próprio Firebase, sem sair do plano gratuito
  para o volume de uma loja deste porte.
- **Apagar contas Firebase Auth ao remover um utilizador:** atualmente, remover alguém
  em Equipa retira o acesso à app (apaga o perfil em `team`), mas a conta continua a
  existir em Authentication. Para apagar por completo é preciso fazê-lo manualmente na
  consola Firebase, ou automatizar com uma Cloud Function no futuro.
- **Granularidade dos dados:** encomendas/clientes/definições vivem hoje num único
  documento Firestore (`app_data/main`), o que é simples e suficiente para o volume
  atual. Se a loja crescer muito (milhares de encomendas), o próximo passo natural é
  separar em coleções próprias (`orders/{id}`, `clients/{id}`) para escalar melhor.
