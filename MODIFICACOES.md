# Modificações Realizadas no ScrumWay

Este documento resume as principais alterações feitas no projeto durante a organização e correção do sistema.

## 1. Organização da estrutura

A estrutura inicial foi reorganizada para separar melhor frontend, backend e infraestrutura.

Antes, os arquivos estáticos ficavam em `docs/` e os arquivos de infraestrutura estavam na raiz. Agora:

```text
scrumway/
├── backend/
│   ├── app.py
│   ├── models.py
│   └── Dockerfile
├── frontend/
│   ├── public/
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── style.css
│   │   └── favicon.png
│   ├── package.json
│   └── server.js
├── infra/
│   ├── init.sql
│   ├── nginx.conf
│   └── supervisord.conf
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── seed_admin.py
└── README.md
```

Arquivos movidos:

- `docs/` -> `frontend/public/`
- `package.json` -> `frontend/package.json`
- `server.js` -> `frontend/server.js`
- `nginx.conf` -> `infra/nginx.conf`
- `supervisord.conf` -> `infra/supervisord.conf`
- `init.sql` -> `infra/init.sql`

## 2. Ajustes no Docker

O `Dockerfile` principal foi atualizado para copiar os novos caminhos:

- frontend de `frontend/public/` para `/usr/share/nginx/html/`
- Nginx de `infra/nginx.conf`
- Supervisor de `infra/supervisord.conf`

O `docker-compose.yml` foi ajustado para carregar variáveis diretamente do `.env`:

```yaml
env_file:
  - .env
```

Isso removeu credenciais hardcoded do compose.

## 3. Configuração de ambiente e MariaDB

Foi criado um arquivo `.env` para concentrar variáveis da aplicação e conexão com MariaDB.

Variáveis usadas pelo backend:

```env
MARIADB_HOST=
MARIADB_PORT=
MARIADB_DATABASE=
MARIADB_USER=
MARIADB_PASSWORD=
AUTH_SECRET=
ADMIN_PASSWORD=
```

O backend passou a montar a conexão com o banco usando as variáveis `MARIADB_*` quando `DATABASE_URL` não estiver definido.

Também foi atualizado o `.env.example` para documentar o formato esperado.

## 4. Conexão com banco

A conexão do container com o MariaDB foi validada de dentro do Docker.

Resultado confirmado:

```text
Conexão OK: database=scrumway
```

Foi identificado que testes feitos fora do container podiam falhar porque o MariaDB aceitava conexões apenas da rede Docker.

## 5. Usuário administrador

Foi analisada a criação do usuário padrão:

```text
usuário: admin
senha: 12345678
```

Foi identificado um problema de tamanho na coluna `password_hash`: o Werkzeug atual gera hash `scrypt` maior que `VARCHAR(128)`.

Como o usuário do banco não possuía permissão de `ALTER TABLE`, a solução usada foi gerar hash compatível com `pbkdf2:sha256`, que cabe na coluna atual.

SQL recomendado para criar/atualizar o admin:

```sql
INSERT INTO user (
  username,
  email,
  password_hash,
  role,
  force_password_change
) VALUES (
  'admin',
  'admin@example.com',
  'pbkdf2:sha256:600000$wcWujBsUzxOhkTyt$c06dbdb3fbc787b848c801c581c5873cf063e0a43a33020c833c890daca69c96',
  'admin',
  0
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  password_hash = VALUES(password_hash),
  role = VALUES(role),
  force_password_change = VALUES(force_password_change);
```

## 6. Correção de login

Foi verificado que o backend aceitava corretamente:

```text
admin / 12345678
```

A API retornava status `200`, token e dados do usuário.

O problema estava no frontend: a sessão local `_sw_s` era salva ofuscada em base64, mas o login tentava ler com `JSON.parse` direto.

Foi corrigido para usar:

```js
const activeSession = getObfuscatedItem(SESSION_KEY);
```

## 7. Persistência após F5

Antes, ao pressionar `F5`, o sistema sempre voltava para a tela de login porque o `init()` terminava com:

```js
showView('login');
```

Foi adicionada a função `restoreSession()` para restaurar a sessão quando houver token válido e cofre local acessível.

Também foi adicionada uma chave em `sessionStorage`:

```js
const SESSION_PASSWORD_KEY = '_sw_sp';
```

A senha fica apenas na sessão da aba do navegador, permitindo reabrir o cofre após `F5`. No logout, ela é removida.

## 8. Correção da importação JSON

A importação inicialmente exigia um campo `users`, mas o próprio backup exportado pelo sistema não tinha esse campo. Isso fazia backups válidos serem recusados.

A validação foi ajustada para aceitar tarefas sem depender de `users`.

Formatos aceitos atualmente:

```json
[
  { "description": "Minha tarefa" }
]
```

```json
{
  "tasks": []
}
```

```json
{
  "tarefas": []
}
```

```json
{
  "cards": []
}
```

```json
{
  "items": []
}
```

Também foram aceitos nomes alternativos de campos:

- `title` ou `titulo`
- `description`, `descricao`, `descrição`, `text` ou `name`
- `priority`, `prioridade`, `story_points` ou `points`
- `assignee`, `responsavel` ou `responsável`
- `column`, `coluna` ou `status`

## 9. Remapeamento de usuário na importação

A base JSON de exemplo usava:

```json
"currentUser": "demo"
```

E as tarefas tinham:

```json
"owner": "demo"
```

Como o quadro renderiza apenas tarefas do usuário logado, os dados importados ficavam invisíveis para `admin` ou outro usuário.

Foi adicionado remapeamento automático:

- `owner: "demo"` vira o usuário logado
- `productVision.demo` vira `productVision.<usuario_logado>`
- `sprintGoal.demo` vira `sprintGoal.<usuario_logado>`
- `sprintIncrement.demo` vira `sprintIncrement.<usuario_logado>`
- `sprintPeriod.demo` vira `sprintPeriod.<usuario_logado>`
- `impediments.demo` vira `impediments.<usuario_logado>`
- `dod.demo` vira `dod.<usuario_logado>`

## 10. Publicação das alterações

Após as correções no frontend, o container foi reconstruído e reiniciado com:

```bash
docker compose up -d --build
```

A aplicação permanece disponível em:

```text
http://localhost:8001
```

Após alterações no JavaScript, recomenda-se carregar a página com cache limpo:

```text
Ctrl + F5
```

## Observações pendentes

Pontos recomendados para próximas etapas:

- Criar migrations para o banco de dados.
- Ampliar `password_hash` para `VARCHAR(255)` quando houver permissão de `ALTER TABLE`.
- Mover tarefas, sprints, DoD e impedimentos para tabelas reais no backend.
- Remover dependência do `localStorage` como armazenamento principal do quadro.
- Separar frontend e backend em containers distintos em uma etapa futura.
