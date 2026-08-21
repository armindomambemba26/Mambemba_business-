# MAMBEMBA BUSINESS — v3.3 (Firebase)

Sistema de gestão de encomendas, clientes, equipa e financeiro da **Mambemba Business**,
construído em HTML/CSS/JavaScript e ligado ao **Firebase** para autenticação, sincronização em nuvem e armazenamento de fotos. A interface continua adequada para GitHub Pages.

> **Cuidamos do teu estilo.**

---

## 1. O que esta versão é (e o que não é)

- ✅ HTML5 + CSS3 + JavaScript puro (Vanilla JS). Sem Node.js, sem PHP, sem frameworks de backend.
- ✅ Dados guardados no **LocalStorage** do navegador (`mb_v32_data`, `mb_v32_session`).
- ✅ Fotos dos produtos guardadas no **IndexedDB** do navegador (com reserva automática em LocalStorage se o IndexedDB não estiver disponível).
- ✅ Funciona 100% no GitHub Pages, sem `npm install`, sem servidor próprio.
- ⚠️ **A autenticação é local ao navegador.** Não existe JWT, PostgreSQL, Firebase ou
  autenticação de servidor — é uma proteção de acesso simples, adequada para uso
  interno da equipa, mas **não apropriada para dados empresariais altamente sensíveis**.
- ⚠️ Os dados ficam **guardados no dispositivo/navegador que os criou**. Se limpar os
  dados do navegador, ou usar outro dispositivo, os dados não aparecem automaticamente —
  não há sincronização entre aparelhos nesta versão (isso exigiria um backend).
  **Use a secção Definições → Cópia de segurança para exportar um ficheiro `.json`
  regularmente** (por exemplo, uma vez por semana), guardando-o no Google Drive ou
  enviando para si próprio por WhatsApp/e-mail. Isso permite restaurar tudo (via
  Importar dados) caso o navegador seja limpo ou o telemóvel seja trocado.
- ⚠️ A validação de recibo por QR Code é **local**: confirma que o código corresponde a
  um recibo emitido neste dispositivo/loja, não é uma validação empresarial centralizada.

Este design foi feito para permitir, no futuro, migrar para uma versão com backend real
(API + base de dados), sem precisar de reescrever a interface.

---

## 2. Acesso inicial

| Utilizador | Palavra-passe |
|---|---|
| `Admin` | `03052000` |

**Recomendação:** depois do primeiro acesso, vá a **Equipa** e crie utilizadores
individuais para cada pessoa da equipa (Gestor, Vendedor, Entregador, Financeiro),
em vez de todos usarem a conta Admin.

### Funções e permissões

| Função | Acesso |
|---|---|
| Admin | Total (painel, encomendas, clientes, equipa, financeiro) |
| Gestor | Painel, encomendas, clientes, equipa, financeiro |
| Vendedor | Painel, encomendas, clientes |
| Entregador | Painel, encomendas |
| Financeiro | Painel, financeiro |

---

## 3. Como publicar no GitHub Pages (passo a passo)

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

## 4. Estrutura de ficheiros

```
index.html      → estrutura de toda a aplicação (login, painel, modais)
style.css       → identidade visual e responsividade
app.js          → toda a lógica: autenticação, encomendas, clientes, equipa,
                  financeiro, recibo A4, partilha, pesquisa
qrcode.js        → gerador de QR Code local (sem internet, sem API externa)
manifest.json    → permite "instalar" o painel no ecrã inicial do telemóvel
README.md        → este ficheiro
```

Não é necessário um servidor próprio nem `npm install`; os SDKs Firebase são carregados no navegador.

---

## 5. Funcionalidades incluídas

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

## 6. Notas para o crescimento futuro

Quando a Mambemba Business precisar de sincronizar dados entre vários dispositivos
(por exemplo, vendedores em locais diferentes vendo as mesmas encomendas em tempo real),
o próximo passo natural é adicionar um backend real (API + base de dados). A estrutura
de dados desta versão (`orders`, `clients`, `team`) foi pensada para poder ser migrada
para esse cenário sem grandes alterações na interface.
