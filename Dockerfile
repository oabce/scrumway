FROM python:3.11-slim

# Instala Nginx e Supervisord para gerenciar os dois processos.
# Alguns ambientes bloqueiam os mirrors Debian via HTTP; força HTTPS antes do apt-get update.
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        nginx \
        supervisor \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências Python (PyMySQL é puro Python, sem libs nativas)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt gunicorn

# Copia o backend Python
COPY backend/ ./backend/

# Copia os arquivos estáticos do frontend para o Nginx
COPY frontend/public/ /usr/share/nginx/html/
RUN chmod -R 755 /usr/share/nginx/html

# Configuração do Nginx
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Configuração do Supervisord
COPY infra/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 8001

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
