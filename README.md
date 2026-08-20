# Mambemba Business V3.1

Sistema online baseado na V3 fornecida, preparado para:

- Frontend responsivo
- API Node.js/Express
- PostgreSQL
- JWT + permissões por função
- Firebase Storage para fotos e PDFs
- PDF A4 gerado no servidor
- QR Code que valida o recibo online
- Partilha por WhatsApp, e-mail e SMS
- Notificações Web Push via Firebase Cloud Messaging (estrutura pronta)
- Clientes
- Financeiro
- Histórico/auditoria
- Botão **Sair**
- Deploy do frontend no Firebase Hosting
- Deploy da API num serviço Node gratuito como Render
- Código versionado no GitHub

## Funções

- admin: acesso total
- gestor: gestão operacional, clientes, equipa e financeiro
- vendedor: encomendas e clientes
- entregador: alteração do estado da entrega
- financeiro: módulo financeiro

## Arquitetura gratuita

GitHub → código/repositório
Firebase Hosting → frontend HTTPS
Firebase Storage → fotos + PDFs
Firebase Cloud Messaging → notificações
Render Free → API Node/Express HTTPS
Neon Free → PostgreSQL

O PostgreSQL não é fornecido pelo Firebase como PostgreSQL tradicional. Por isso esta versão usa Neon como banco PostgreSQL gratuito.

## Deploy

### 1. PostgreSQL
Crie um projeto PostgreSQL gratuito no Neon e copie `DATABASE_URL`.

### 2. Firebase
Crie um projeto Firebase:
- Authentication não é obrigatório nesta arquitetura porque a API usa JWT.
- Ative Storage.
- Ative Cloud Messaging para Web.
- Crie uma Web App e copie a configuração para `firebase-messaging-sw.js`.
- Crie uma conta de serviço para o backend e use as credenciais como variáveis de ambiente.

### 3. API
Suba `backend/` para GitHub.
No Render:
- New → Web Service
- repositório GitHub
- Build: `npm install`
- Start: `npm start`
- adicione as variáveis do `.env.example`
- não coloque `.env` no GitHub.

A API ficará em HTTPS.

### 4. Frontend
No frontend, altere a constante `API` em `index.html` para a URL pública da API.

Depois:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

Escolha a pasta `frontend` como public directory.

### 5. Primeiro acesso
Utilizador: `Admin`
Palavra-passe: `03052000`

**Troque a palavra-passe imediatamente após o primeiro acesso.**

## Notificações
A base do FCM está preparada no backend. Para completar o push no navegador:
1. configure a Firebase Web App;
2. coloque a configuração no service worker;
3. obtenha o token FCM no frontend;
4. envie-o para `/api/push/token`;
5. o backend já tem `/api/push/test` para teste de envio.

## QR Code
Cada encomenda recebe `public_token`.
O PDF contém um QR Code que aponta para:
`https://SUA-API/api/verify/TOKEN`

A página pública consulta PostgreSQL e mostra se o recibo é válido.

## Observação importante sobre "100% gratuito"
Os componentes acima têm opções gratuitas, mas quotas e condições podem mudar. O Render Free pode adormecer quando fica inativo, e serviços gratuitos de banco podem ter limites. Não trate o sistema como infraestrutura de missão crítica sem backups e monitorização.

## Segurança
- nunca publique `.env`
- use um JWT_SECRET longo e aleatório
- troque a senha inicial
- mantenha o Firebase service account somente no backend
- use HTTPS
- limite tamanho de fotos
- faça backups do PostgreSQL
