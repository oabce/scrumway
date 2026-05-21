# ScrumWay - Gestão Ágil Profissional (v2.1)

ScrumWay é uma aplicação de quadro SCRUM moderna, segura e escalável, projetada para equipes que buscam simplicidade com robustez.

## 🚀 Funcionalidades Principais

- **Arquitetura Organizada**: Backend e Frontend separados para melhor manutenção.
- **Autenticação Segura**: Utiliza **JWT (JSON Web Tokens)** para sessões seguras e expiráveis.
- **Banco de Dados Relacional**: Persistência de usuários e perfis via **MySQL/MariaDB**.
- **Gestão de Perfis**: Suporte a perfis **Team**, **PO**, **SM** e **Admin**.
- **Segurança Avançada**:
    - Senhas com Hashing seguro (PBKDF2).
    - Troca obrigatória de senha padrão.
    - Proteção contra ataques XSS e CSRF.
    - Variáveis de ambiente para segredos sensíveis.

---

## 📂 Estrutura do Projeto

```text
/scrumway
  ├── backend/              # API Python/Flask
  │   ├── app.py            # Rotas e inicialização da API
  │   ├── models.py         # Modelos SQLAlchemy
  │   └── Dockerfile        # Imagem isolada do backend
  ├── frontend/             # Frontend estático
  │   ├── public/           # HTML, CSS, JS e assets
  │   ├── package.json      # Scripts do frontend
  │   └── server.js         # Servidor local simples para desenvolvimento
  ├── infra/                # Arquivos de infraestrutura
  │   ├── init.sql          # Script inicial do banco
  │   ├── nginx.conf        # Proxy reverso e estáticos
  │   └── supervisord.conf  # Processos do container integrado
  ├── data/                 # Dados locais e arquivos gerados
  ├── Dockerfile            # Imagem integrada: Nginx + Gunicorn
  ├── docker-compose.yml    # Orquestração local/produção simples
  ├── requirements.txt      # Dependências Python
  └── README.md             # Documentação
```

---

## 🛠️ Configuração e Instalação

### 1. Preparar o Ambiente
```bash
git clone https://github.com/nadsonpaulo/ScrumWay.git
cd ScrumWay
python3 -m pip install -r requirements.txt
```

### 2. Configurar Variáveis
Crie o arquivo `.env` na raiz:
```bash
AUTH_SECRET=seu_segredo_aleatorio_aqui
ADMIN_PASSWORD=admin
```

### 3. Iniciar o Sistema
Inicie o backend:
```bash
python3 backend/app.py
```
O backend estará ativo em `http://localhost:5000`.

Para servir apenas o frontend em desenvolvimento:
```bash
cd frontend
npm start
```
O frontend estará ativo em `http://localhost:8001`.

---

## 🔑 Acesso Administrativo

O usuário inicial é `admin` com a senha definida no seu `.env` (padrão `admin`). No primeiro login, o sistema exigirá a criação de uma senha forte de no mínimo 8 caracteres.

---

## 🌐 Deploy (Produção)

- **Frontend**: A pasta `frontend/public/` contém os arquivos estáticos.
- **Backend**: O código é compatível com **Render**, **Railway** ou **PythonAnywhere**. 
    - Lembre-se de configurar as variáveis de ambiente `AUTH_SECRET` e `ADMIN_PASSWORD` no painel da sua hospedagem.

---

## 📄 Licença
Desenvolvido para gestão ágil e colaborativa.
