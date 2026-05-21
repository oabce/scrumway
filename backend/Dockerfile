FROM python:3.11-slim

WORKDIR /app

# PyMySQL é um driver puro Python, sem necessidade de bibliotecas nativas do MySQL
RUN pip install --no-cache-dir gunicorn

# O contexto de build é a raiz do projeto
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia apenas o conteúdo da pasta backend
COPY backend/ .


EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "3", "app:app"]
