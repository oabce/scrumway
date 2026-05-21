from flask import Flask, request, jsonify
from flask_cors import CORS
from models import db, User
import os
import jwt
import datetime
from functools import wraps
from dotenv import load_dotenv
import time
from urllib.parse import quote_plus

# Carrega variáveis de ambiente do arquivo .env
load_dotenv()

app = Flask(__name__)
# Restringe o CORS para ser mais seguro, removendo suporte a credenciais com origem curinga
CORS(app, resources={r"/api/*": {"origins": "*"}})

# Configurações de Segurança e Banco de Dados
basedir = os.path.abspath(os.path.dirname(__file__))
db_url = os.environ.get('DATABASE_URL')
if not db_url:
    db_user = os.environ.get('MARIADB_USER', 'scrumway')
    db_password = quote_plus(os.environ.get('MARIADB_PASSWORD', 'scrumway_pass'))
    db_host = os.environ.get('MARIADB_HOST', 'scrumway_db')
    db_port = os.environ.get('MARIADB_PORT', '3306')
    db_name = os.environ.get('MARIADB_DATABASE', 'scrumway_db')
    db_url = f'mysql+pymysql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}'
app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SECRET_KEY'] = os.environ.get('AUTH_SECRET', 'scrumway_default_secret_key_2024')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Cria o banco de dados e o usuário admin se não existir
with app.app_context():
    retries = 5
    while retries > 0:
        try:
            db.create_all()
            if not User.query.filter_by(username='admin').first():
                admin_pass = os.environ.get('ADMIN_PASSWORD', 'admin')
                force_change = (admin_pass == 'admin')
                admin = User(username='admin', email='admin@example.com', role='admin', force_password_change=force_change)
                admin.set_password(admin_pass)
                db.session.add(admin)
                db.session.commit()
            print("Conectado ao banco de dados com sucesso!")
            break
        except Exception as e:
            print(f"Banco de dados não disponível. Tentando novamente em 5 segundos... ({e})")
            retries -= 1
            time.sleep(5)

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization')
        if not token:
            return jsonify({'error': 'Token ausente'}), 401
        try:
            # Token no formato "Bearer <token>"
            if token.startswith('Bearer '):
                token = token.split(" ")[1]
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            current_user = User.query.get(data['user_id'])
            if not current_user:
                raise ValueError("Usuário não encontrado")
        except Exception as e:
            return jsonify({'error': 'Token inválido ou expirado'}), 401
        return f(current_user, *args, **kwargs)
    return decorated

@app.route('/api/admin/users', methods=['GET'])
@token_required
def get_users(current_user):
    if current_user.role != 'admin':
        return jsonify({'error': 'Acesso negado: Requer privilégios de administrador'}), 403
    users = User.query.all()
    return jsonify([user.to_dict() for user in users])

@app.route('/api/users', methods=['GET'])
@token_required
def list_users(current_user):
    users = User.query.all()
    return jsonify([{'username': u.username, 'role': u.role} for u in users])

@app.route('/api/admin/users/<int:user_id>/role', methods=['PATCH'])
@token_required
def update_user_role(current_user, user_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Acesso negado'}), 403
    data = request.get_json()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuário não encontrado"}), 404
    if user.username == 'admin':
        return jsonify({"error": "Não é possível alterar o perfil do administrador principal"}), 400
    
    new_role = data.get('role')
    if new_role not in ['Team', 'PO', 'SM', 'admin']:
        return jsonify({"error": "Perfil inválido"}), 400
        
    user.role = new_role
    db.session.commit()
    return jsonify({"message": "Perfil atualizado com sucesso", "user": user.to_dict()})

@app.route('/api/admin/users/<int:user_id>/reset-password', methods=['POST'])
@token_required
def reset_password(current_user, user_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Acesso negado'}), 403
    data = request.get_json()
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuário não encontrado"}), 404
    
    new_password = data.get('password')
    if not new_password or len(new_password) < 8:
        return jsonify({"error": "Senha deve ter no mínimo 8 caracteres"}), 400
        
    user.set_password(new_password)
    db.session.commit()
    return jsonify({"message": "Senha redefinida com sucesso"})

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
@token_required
def delete_user(current_user, user_id):
    if current_user.role != 'admin':
        return jsonify({'error': 'Acesso negado'}), 403
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "Usuário não encontrado"}), 404
    if user.username == 'admin':
        return jsonify({"error": "Não é possível excluir o administrador principal"}), 400
    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Usuário excluído com sucesso"})

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password') or not data.get('email'):
        return jsonify({"error": "Dados incompletos"}), 400
    
    if User.query.filter_by(username=data['username']).first():
        return jsonify({"error": "Usuário já existe"}), 400
    
    import re
    email_regex = r'^[\w\.-]+@[\w\.-]+\.\w+$'
    if not re.match(email_regex, data['email']):
        return jsonify({"error": "Formato de e-mail inválido"}), 400
    
    if User.query.filter_by(email=data['email']).first():
        return jsonify({"error": "Email já cadastrado"}), 400
    
    if len(data['password']) < 8:
        return jsonify({"error": "Senha deve ter no mínimo 8 caracteres"}), 400
        
    new_user = User(username=data['username'], email=data['email'])
    new_user.set_password(data['password'])
    
    db.session.add(new_user)
    db.session.commit()
    
    return jsonify({"message": "Usuário criado com sucesso", "user": new_user.to_dict()}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    
    if not data or not data.get('username') or not data.get('password'):
        return jsonify({"error": "Dados incompletos"}), 400
    
    user = User.query.filter_by(username=data['username']).first()
    
    if user and user.check_password(data['password']):
        token = jwt.encode({
            'user_id': user.id,
            'exp': datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=24)
        }, app.config['SECRET_KEY'], algorithm="HS256")
        
        return jsonify({
            "message": "Login realizado com sucesso", 
            "token": token,
            "user": user.to_dict()
        }), 200
    
    return jsonify({"error": "Credenciais inválidas"}), 401

@app.route('/api/change-password', methods=['POST'])
@token_required
def change_password(current_user):
    data = request.get_json()
    new_password = data.get('password')
    
    if not new_password or len(new_password) < 8:
        return jsonify({"error": "A nova senha deve ter no mínimo 8 caracteres"}), 400
        
    current_user.set_password(new_password)
    current_user.force_password_change = False
    db.session.commit()
    return jsonify({"message": "Senha alterada com sucesso"})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
