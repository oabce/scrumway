"""
Executa este script dentro do container do backend para criar o admin manualmente:
  docker exec -it scrumway_backend python seed_admin.py
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv()

# Garante que o diretório do backend está no path (para importar models)
sys.path.insert(0, os.path.dirname(__file__))

from app import app, db
from models import User

ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '12345678')

with app.app_context():
    existing = User.query.filter_by(username='admin').first()
    if existing:
        # Força o reset da senha do admin para o valor configurado
        existing.set_password(ADMIN_PASSWORD)
        existing.force_password_change = False
        db.session.commit()
        print(f"✅ Senha do 'admin' redefinida para: {ADMIN_PASSWORD}")
    else:
        admin = User(
            username='admin',
            email='admin@scrumway.local',
            role='admin',
            force_password_change=False
        )
        admin.set_password(ADMIN_PASSWORD)
        db.session.add(admin)
        db.session.commit()
        print(f"✅ Usuário 'admin' criado com senha: {ADMIN_PASSWORD}")
