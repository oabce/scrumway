const columns = ['stories','todo','inprogress','review','done'];
const fibonacci = [1,2,3,5,8,13];
const taskCategories = [
  { value: 'frontend', label: 'Frontend', short: 'FEnd', color: '#3b82f6' },
  { value: 'backend', label: 'Backend', short: 'BEnd', color: '#ef4444' },
  { value: 'infra', label: 'Infraestrutura', short: 'Inf', color: '#10b981' },
  { value: 'bugs', label: 'Bugs', short: 'Bugs', color: '#f59e0b' },
  { value: 'uxui', label: 'UX/UI', short: 'UX/UI', color: '#8b5cf6' },
  { value: 'docs', label: 'Documentação', short: 'Doc', color: '#64748b' }
];
const defaultState = {
  currentUser: null,
  role: 'Team',
  notes: {},
  productVision: {},
  sprintIncrement: {},
  teamMembers: {},
  tasks: [],
  sprintGoal: {},
  sprintPeriod: {},
  impediments: {},
  dod: {}
};

const VAULT_PREFIX = '_sw_v_';
const SESSION_KEY = '_sw_s';
const SESSION_PASSWORD_KEY = '_sw_sp';
const SALT = 'scrumway_salt_2024';
const API_URL = '/api';

function hashStringSync(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return 'u' + Math.abs(hash).toString(16);
}

function setObfuscatedItem(key, obj) {
  localStorage.setItem(key, btoa(encodeURIComponent(JSON.stringify(obj))));
}

function getObfuscatedItem(key) {
  const val = localStorage.getItem(key);
  if (!val) return {};
  try {
    return JSON.parse(decodeURIComponent(atob(val)));
  } catch (e) {
    return {};
  }
}

function migrateLegacyStorage() {
  const oldUsers = localStorage.getItem('scrumway_users');
  if (oldUsers) {
    localStorage.setItem('_sw_u', oldUsers);
    localStorage.removeItem('scrumway_users');
  }
  const keysToMigrate = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('scrumway_vault_')) {
      keysToMigrate.push(key);
    }
  }
  keysToMigrate.forEach(key => {
    const username = key.substring('scrumway_vault_'.length);
    const newKey = '_sw_v_' + hashStringSync(username);
    const val = localStorage.getItem(key);
    if (val) {
      localStorage.setItem(newKey, val);
    }
    localStorage.removeItem(key);
  });
  localStorage.removeItem('scrumway_active_session');
}

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

let state = { ...defaultState };
let currentVaultPassword = '';
let sessionHeartbeat = null;
let currentSessionID = generateUUID();
let elements = {};
let editModal;
let impedimentReasonModal;
let pendingImpedimentTaskId = null;
let systemUsers = [];
let burndownResizeTimer = null;

document.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', () => {
  if (!state.currentUser || !elements.burndownChart) return;
  clearTimeout(burndownResizeTimer);
  burndownResizeTimer = setTimeout(renderBurndown, 120);
});

// --- Utilitários de Segurança ---
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Funções de Criptografia ---

async function deriveKey(password) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: 100000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, password) {
  if (!window.crypto || !crypto.subtle) {
    // Insecure fallback for HTTP development environments
    return 'fallback:' + btoa(encodeURIComponent(JSON.stringify(data)));
  }
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedBase64, password) {
  try {
    if (encryptedBase64.startsWith('fallback:')) {
      return JSON.parse(decodeURIComponent(atob(encryptedBase64.substring(9))));
    }
    const key = await deriveKey(password);
    const combined = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (e) {
    return null;
  }
}

async function persistVault() {
  if (!currentVaultPassword || !state.currentUser) return;
  const encrypted = await encryptData(state, currentVaultPassword);
  localStorage.setItem(VAULT_PREFIX + state.currentUser, encrypted);
}

async function saveState() {
  localStorage.setItem('scrumway_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  if (state.currentUser) await persistVault();
}

// --- Funções de Sessão ---

function startSession(username) {
  currentSessionID = generateUUID();
  const updateSession = () => {
    setObfuscatedItem(SESSION_KEY, {
      username,
      sessionID: currentSessionID,
      lastSeen: Date.now()
    });
  };
  updateSession();
  if (sessionHeartbeat) clearInterval(sessionHeartbeat);
  sessionHeartbeat = setInterval(updateSession, 5000);

  window.onstorage = (e) => {
    if (e.key === SESSION_KEY) {
      const sess = getObfuscatedItem(SESSION_KEY);
      if (sess.username === state.currentUser && sess.sessionID !== currentSessionID) {
        logout();
        showFlash('Sessão encerrada: login detectado em outro local.', 'danger');
      }
    }
  };
}
async function restoreSession() {
  const token = sessionStorage.getItem('scrumway_token');
  const savedPassword = sessionStorage.getItem(SESSION_PASSWORD_KEY);
  const sess = getObfuscatedItem(SESSION_KEY);
  if (!token || !savedPassword || !sess.username) return false;

  const vault = localStorage.getItem(VAULT_PREFIX + sess.username);
  const loadedState = vault ? await decryptData(vault, savedPassword) : { ...defaultState };
  if (!loadedState) return false;

  try {
    const res = await apiFetch(API_URL + '/users');
    if (!res.ok) return false;
  } catch (e) {
    return false;
  }

  currentVaultPassword = savedPassword;
  state = { ...defaultState, ...loadedState };
  state.currentUser = sess.username;

  try {
    const usersRes = await apiFetch(API_URL + '/users');
    const users = await usersRes.json();
    const current = users.find(u => u.username === sess.username);
    state.role = current ? current.role : (state.role || 'Team');
  } catch (e) {}

  startSession(sess.username);
  elements.adminBtn.classList.toggle('hidden', state.role !== 'admin');
  showView('board');
  return true;
}

// --- Inicialização e Auth ---

const USERS_KEY = '_sw_u';

async function getLocalUsers() {
  const encrypted = localStorage.getItem(USERS_KEY);
  if (!encrypted) {
    const adminHash = await hashPassword('12345678');
    const defaultUsers = [
      {
        id: 1,
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: adminHash,
        role: 'admin',
        force_password_change: true
      }
    ];
    await saveLocalUsers(defaultUsers);
    return defaultUsers;
  }

  // Seamless migration from legacy plaintext database
  if (encrypted.trim().startsWith('[')) {
    try {
      const legacyUsers = JSON.parse(encrypted);
      if (Array.isArray(legacyUsers)) {
        const adminUser = legacyUsers.find(u => u.username === 'admin');
        if (adminUser) {
          adminUser.passwordHash = await hashPassword('12345678');
          adminUser.force_password_change = true;
        }
        await saveLocalUsers(legacyUsers);
        return legacyUsers;
      }
    } catch (e) {}
  }
  
  try {
    const users = await decryptData(encrypted, SALT);
    if (users && Array.isArray(users)) {
      const adminUser = users.find(u => u.username === 'admin');
      if (adminUser) {
        adminUser.passwordHash = await hashPassword('12345678');
        adminUser.force_password_change = true;
        await saveLocalUsers(users);
      }
      return users;
    }
  } catch (e) {}

  const adminHash = await hashPassword('12345678');
  const defaultUsers = [
    {
      id: 1,
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: adminHash,
      role: 'admin',
      force_password_change: true
    }
  ];
  await saveLocalUsers(defaultUsers);
  return defaultUsers;
}

async function saveLocalUsers(users) {
  const encrypted = await encryptData(users, SALT);
  localStorage.setItem(USERS_KEY, encrypted);
}

async function init() {
  migrateLegacyStorage();
  if (window.self !== window.top) { window.top.location = window.self.location; return; }
  elements = {
    loginSection: document.getElementById('loginSection'),
    registerSection: document.getElementById('registerSection'),
    boardSection: document.getElementById('boardSection'),
    flashContainer: document.getElementById('flashContainer'),
    btnTheme: document.getElementById('btnTheme'),
    boardUsername: document.getElementById('boardUsername'),
    notesText: document.getElementById('notesText'),
    productVisionText: document.getElementById('productVisionText'),
    sprintIncrementText: document.getElementById('sprintIncrementText'),
    dodText: document.getElementById('dodText'),
    authButtons: document.getElementById('authButtons'),
    adminBtn: document.getElementById('adminBtn'),
    usersTableBody: document.getElementById('usersTableBody'),
    adminSection: document.getElementById('adminSection'),
    sprintGoal: document.getElementById('sprintGoal'),
    sprintPeriod: document.getElementById('sprintPeriod'),
    burndownChart: document.querySelector('.burndown-viz'),
    impedimentsContainer: document.getElementById('impedimentsContainer'),
    dodContainer: document.getElementById('dodContainer'),
    counts: {
      stories: document.getElementById('countStories'),
      todo: document.getElementById('countTodo'),
      inprogress: document.getElementById('countInProgress'),
      review: document.getElementById('countReview'),
      done: document.getElementById('countDone')
    }
  };
  const modalEl = document.getElementById('editTaskModal');
  if (modalEl) editModal = new bootstrap.Modal(modalEl);
  const impedimentReasonModalEl = document.getElementById('impedimentReasonModal');
  if (impedimentReasonModalEl) {
    impedimentReasonModal = new bootstrap.Modal(impedimentReasonModalEl);
    impedimentReasonModalEl.addEventListener('hidden.bs.modal', () => {
      if (!pendingImpedimentTaskId) return;
      pendingImpedimentTaskId = null;
      renderBoard();
    });
  }
  const impedimentReasonForm = document.getElementById('impedimentReasonForm');
  if (impedimentReasonForm) impedimentReasonForm.onsubmit = handleSaveImpedimentReason;
  if (document.getElementById('loginForm')) document.getElementById('loginForm').onsubmit = handleLogin;
  if (document.getElementById('registerForm')) document.getElementById('registerForm').onsubmit = handleRegister;
  if (document.getElementById('addMemberForm')) document.getElementById('addMemberForm').onsubmit = handleAddMember;
  if (document.getElementById('notesForm')) document.getElementById('notesForm').onsubmit = handleSaveNotes;
  if (document.getElementById('productVisionForm')) document.getElementById('productVisionForm').onsubmit = handleSaveProductVision;
  document.getElementById('backToLoginFromRegister').onclick = () => showView('login');
  document.getElementById('showRegister').onclick = () => showView('register');
  document.getElementById('exportDataBtn').onclick = exportData;
  document.getElementById('importDataBtn').onclick = () => document.getElementById('importFile').click();
  document.getElementById('importFile').onchange = importData;
  document.getElementById('logoutBtn').onclick = logout;
  document.getElementById('decrementPriority').onclick = () => adjustPriority(-1);
  document.getElementById('incrementPriority').onclick = () => adjustPriority(1);
  document.getElementById('backToBoardFromAdmin').onclick = () => showView('board');
  document.getElementById('adminBtn').onclick = () => showView('admin');

  // Novo Usuário - Toggle do formulário
  document.getElementById('toggleNewUserForm').onclick = () => {
    const card = document.getElementById('newUserFormCard');
    card.style.display = card.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('generatePasswordBtn').onclick = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let pwd = '';
    for (let i = 0; i < 8; i++) pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    document.getElementById('newUserPassword').value = pwd;
  };
  document.getElementById('cancelNewUser').onclick = () => {
    document.getElementById('newUserFormCard').style.display = 'none';
    document.getElementById('createUserForm').reset();
  };
  document.getElementById('createUserForm').onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('newUserUsername').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;

    try {
      const res = await apiFetch(`${API_URL}/register`, {
        method: 'POST',
        body: JSON.stringify({ username, email, password })
      });
      const data = await res.json();
      if (!res.ok) {
        return showFlash(data.error || 'Erro ao criar usuário.', 'danger');
      }

      if (role !== 'Team') {
        await apiFetch(`${API_URL}/admin/users/${data.user.id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role })
        });
      }

      systemUsers = [];

      showFlash(`Usuário "${username}" criado com sucesso!`, 'success');
      document.getElementById('createUserForm').reset();
      document.getElementById('newUserFormCard').style.display = 'none';
      await loadUsers();
    } catch (err) {
      showFlash('Erro ao criar usuário.', 'danger');
    }
  };
  if (elements.btnTheme) elements.btnTheme.onclick = toggleTheme;

  // F11 - Modo Foco (Quadro em tela cheia)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      const isFocus = document.body.classList.toggle('focus-mode');
      if (isFocus) {
        document.documentElement.requestFullscreen?.() || document.documentElement.webkitRequestFullscreen?.();
      } else {
        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
      }
      setTimeout(renderBurndown, 180);
    }
    // ESC sai do modo foco
    if (e.key === 'Escape' && document.body.classList.contains('focus-mode')) {
      document.body.classList.remove('focus-mode');
    }
  });

  // Sincroniza ao sair do fullscreen pelo botão nativo
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) {
      document.body.classList.remove('focus-mode');
    }
    setTimeout(renderBurndown, 180);
  });
  // Re-renderiza burndown ao redimensionar a janela (debounce)
  window.addEventListener('resize', () => {
    if (burndownResizeTimer) clearTimeout(burndownResizeTimer);
    burndownResizeTimer = setTimeout(() => renderBurndown(), 200);
  });
  if (elements.sprintGoal) {
    elements.sprintGoal.oninput = async () => { 
      elements.sprintGoal.style.height = 'auto';
      elements.sprintGoal.style.height = elements.sprintGoal.scrollHeight + 'px';
      
      if (!state.sprintGoal) state.sprintGoal = {}; 
      state.sprintGoal[state.currentUser] = elements.sprintGoal.value; 
      await saveState(); 
    };
  }
  
  if (elements.productVisionText) {
    elements.productVisionText.oninput = async () => { 
      elements.productVisionText.style.height = 'auto';
      elements.productVisionText.style.height = elements.productVisionText.scrollHeight + 'px';
      
      if (!state.productVision) state.productVision = {}; 
      state.productVision[state.currentUser] = elements.productVisionText.value; 
      await saveState(); 
    };
  }
  
  if (elements.sprintIncrementText) {
    elements.sprintIncrementText.oninput = async () => { 
      elements.sprintIncrementText.style.height = 'auto';
      elements.sprintIncrementText.style.height = elements.sprintIncrementText.scrollHeight + 'px';
      
      if (!state.sprintIncrement) state.sprintIncrement = {}; 
      state.sprintIncrement[state.currentUser] = elements.sprintIncrementText.value; 
      await saveState(); 
    };
  }
  
  if (elements.sprintPeriod) {
    flatpickr(elements.sprintPeriod, {
      mode: "range",
      dateFormat: "d/m/Y",
      locale: "pt",
      onClose: async (selectedDates) => {
        if (selectedDates.length === 2) {
          if (!state.sprintPeriod) state.sprintPeriod = {};
          state.sprintPeriod[state.currentUser] = elements.sprintPeriod.value;
          await saveState();
          renderBurndown();
        }
      }
    });
  }
  
  document.onclick = (e) => { if (!e.target.closest('.selection-popup') && !e.target.closest('.badge-clickable')) toggleSelectionPopup(false); };
  const theme = localStorage.getItem('scrumway_theme');
  if (theme === 'dark') document.body.classList.add('dark');
  if (elements.btnTheme) elements.btnTheme.textContent = theme === 'dark' ? '☀️' : '🌙';
  await getLocalUsers();
  if (await restoreSession()) return;
  showView('login');
}

async function handleLogin(event) {
  event.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  const activeSession = getObfuscatedItem(SESSION_KEY);
  if (activeSession.username === username && (Date.now() - activeSession.lastSeen < 10000)) {
    return showFlash('Este usuário já possui uma sessão ativa em outra aba.', 'warning');
  }

  try {
    const res = await apiFetch(`${API_URL}/login`, {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    
    if (!res.ok) {
      return showFlash(data.error || 'Credenciais inválidas.', 'danger');
    }

    const user = data.user;
    sessionStorage.setItem('scrumway_token', data.token);
    sessionStorage.setItem(SESSION_PASSWORD_KEY, password);

    const vaultKey = VAULT_PREFIX + username;
    const vault = localStorage.getItem(vaultKey);

    // Se não houver vault para este usuário, inicializa um estado padrão
    let loadedState = (vault) ? await decryptData(vault, password) : { ...defaultState };

    if (!loadedState) {
        if (confirm('Sua senha foi validada, mas não conseguimos abrir o seu cofre local (provavelmente ele foi criado com uma senha anterior). \n\nDeseja DESCARTAR os dados locais antigos e iniciar um novo cofre com sua nova senha?')) {
            loadedState = { ...defaultState };
        } else {
            return showFlash('Acesso cancelado. O cofre local permanece bloqueado.', 'warning');
        }
    }

    currentVaultPassword = password;
    state = { ...defaultState, ...loadedState };
    state.currentUser = username;
    state.role = user.role;
    
    startSession(username);
    await persistVault();

    // Verifica se precisa trocar a senha obrigatoriamente
    if (user.force_password_change) {
        const forceModal = new bootstrap.Modal(document.getElementById('forceChangePasswordModal'));
        forceModal.show();
        return; // Para o fluxo de login normal até trocar a senha
    }
    
    // Mostra o botão de admin se for admin
    if (state.role === 'admin') {
        elements.adminBtn.classList.remove('hidden');
    } else {
        elements.adminBtn.classList.add('hidden');
    }

    showFlash(`Login realizado! Bem-vindo, ${username}!`, 'success');
    showView('board');
  } catch (err) {
    showFlash('Erro ao realizar login.', 'danger');
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const username = document.getElementById('registerUsername').value.trim();
  const email = document.getElementById('registerEmail').value.trim().toLowerCase();
  const password = document.getElementById('registerPassword').value;
  const confirm = document.getElementById('registerConfirmPassword').value;

  if (username.length < 3) return showFlash('Usuário muito curto.', 'danger');
  if (password.length < 8) return showFlash('Senha deve ter no mínimo 8 caracteres.', 'danger');
  if (password !== confirm) return showFlash('As senhas não coincidem.', 'danger');

  try {
    const res = await apiFetch(`${API_URL}/register`, {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok) {
      return showFlash(data.error || 'Erro ao registrar usuário.', 'danger');
    }

    showFlash('Usuário cadastrado com sucesso! Agora você pode fazer login.', 'success');
    showView('login');
  } catch (err) {
    showFlash('Erro ao registrar usuário.', 'danger');
  }
}

function logout() { 
  if (sessionHeartbeat) clearInterval(sessionHeartbeat);
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem('scrumway_token');
  sessionStorage.removeItem(SESSION_PASSWORD_KEY);
  currentVaultPassword = ''; 
  state.currentUser = null; 
  showView('login'); 
}

// --- API Helpers ---

async function apiFetch(url, options = {}) {
  const token = sessionStorage.getItem('scrumway_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    logout();
    showFlash('Sessão expirada. Por favor, faça login novamente.', 'danger');
    throw new Error('Unauthorized');
  }
  return response;
}

async function refreshSystemUsers() {
  try {
    const res = await apiFetch(`${API_URL}/users`);
    if (!res.ok) throw new Error('Erro ao buscar usuários.');
    const users = await res.json();
    systemUsers = users.map((user, index) => ({
      id: user.id || index + 1,
      username: user.username,
      role: user.role
    })).filter(user => user.username);
    return systemUsers;
  } catch (err) {
    try {
      const users = await getLocalUsers();
      systemUsers = users.map(user => ({ id: user.id, username: user.username, role: user.role })).filter(user => user.username);
    } catch (e) {}
    return systemUsers;
  }
}

// --- Funções de UI ---

async function renderBoard() {
  if (!state.currentUser) return;
  
  // Busca usuários do sistema para atribuição nas tarefas
  await refreshSystemUsers();

  elements.boardUsername.textContent = state.currentUser;
  if (elements.notesText) elements.notesText.value = (state.notes || {})[state.currentUser] || '';
  if (elements.productVisionText) {
    elements.productVisionText.value = (state.productVision || {})[state.currentUser] || '';
    elements.productVisionText.style.height = 'auto';
    elements.productVisionText.style.height = elements.productVisionText.scrollHeight + 'px';
  }
  if (elements.sprintIncrementText) {
    elements.sprintIncrementText.value = (state.sprintIncrement || {})[state.currentUser] || '';
    elements.sprintIncrementText.style.height = 'auto';
    elements.sprintIncrementText.style.height = elements.sprintIncrementText.scrollHeight + 'px';
  }
  if (elements.sprintGoal) {
    elements.sprintGoal.value = (state.sprintGoal || {})[state.currentUser] || '';
    elements.sprintGoal.style.height = 'auto';
    elements.sprintGoal.style.height = elements.sprintGoal.scrollHeight + 'px';
  }
  if (elements.sprintPeriod) elements.sprintPeriod.value = (state.sprintPeriod || {})[state.currentUser] || '';
  
  const userTasks = state.tasks.filter(t => t.owner === state.currentUser);
  columns.forEach(col => {
    const colTasks = userTasks.filter(t => t.column === col).sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    // Normaliza a ordem
    colTasks.forEach((t, i) => t.order = i);
    const container = document.getElementById(`column${col === 'inprogress' ? 'InProgress' : capitalize(col)}`);
    if (container) container.innerHTML = colTasks.map((t, idx) => taskCard(t, idx)).join('');
    if (elements.counts[col]) elements.counts[col].textContent = colTasks.length;
  });
  renderBurndown();
  renderImpediments();
  renderDod();
  enableDragAndDrop();
}

function renderDod() {
  if (!elements.dodContainer) return;
  const list = state.dod[state.currentUser] || [];
  elements.dodContainer.innerHTML = list.map(item => `
    <div class="card task-card shadow-sm p-3 position-relative" style="border-left: 4px solid #10b981; margin-bottom: 10px;">
      <div class="dropdown position-absolute" style="top:5px; right:5px;">
        <button class="btn btn-link btn-sm p-0 text-muted text-decoration-none" type="button" data-bs-toggle="dropdown" aria-expanded="false" style="font-size: 1.2rem; line-height: 1;">
          ⋮
        </button>
        <ul class="dropdown-menu dropdown-menu-end shadow border-0" style="font-size: 0.8rem; min-width: 100px;">
          <li><button class="dropdown-item py-2 text-danger" onclick="handleDeleteDod('${item.id}')">❌ Excluir</button></li>
        </ul>
      </div>
      <div class="fw-bold mb-0 pe-4" 
           contenteditable="true" 
           oninput="updateDod('${item.id}', this.innerText)" 
           placeholder="Critério de aceite..." 
           style="min-height: 60px; font-size: 0.95rem; line-height: 1.4; outline: none; cursor: text; white-space: pre-wrap;">${escapeHtml(item.text)}</div>
    </div>
  `).join('');
}

window.handleAddDod = async () => {
  if (!state.dod[state.currentUser]) state.dod[state.currentUser] = [];
  state.dod[state.currentUser].push({ id: generateUUID(), text: '' });
  await saveState();
  renderDod();
};

window.handleDeleteDod = async (id) => {
  state.dod[state.currentUser] = (state.dod[state.currentUser] || []).filter(i => i.id !== id);
  await saveState();
  renderDod();
};

window.updateDod = (id, val) => {
  const item = (state.dod[state.currentUser] || []).find(i => i.id === id);
  if (item) {
    item.text = val;
    persistVault();
  }
};

function renderImpediments() {
  if (!elements.impedimentsContainer) return;
  const list = state.impediments[state.currentUser] || [];
  elements.impedimentsContainer.innerHTML = list.map((imp, idx) => impedimentCard(imp, idx)).join('');
}

function impedimentCard(imp, priorityIndex = 0) {
  const task = imp.task || {
    id: imp.id,
    description: imp.text || 'Impedimento sem card vinculado',
    assignee: 'Não atribuído',
    priority: '0'
  };
  const color = getUserColor(task.assignee);
  const reason = imp.text || 'Sem motivo informado';

  return `<div class="card task-card impediment-card shadow-sm p-3 position-relative" draggable="true" data-impediment-id="${imp.id}" style="border-left: 4px solid ${color}">
    <div class="dropdown position-absolute" style="top:5px; right:5px;">
      <button class="btn btn-link btn-sm p-0 text-muted text-decoration-none" type="button" data-bs-toggle="dropdown" aria-expanded="false" style="font-size: 1.2rem; line-height: 1;">
        ⋮
      </button>
      <ul class="dropdown-menu dropdown-menu-end shadow border-0" style="font-size: 0.8rem; min-width: 100px;">
        <li><button class="dropdown-item py-2 text-danger" onclick="handleDeleteImpediment('${imp.id}')">❌ Excluir</button></li>
      </ul>
    </div>
    <div class="fw-bold mb-3 pe-4" style="font-size: 0.95rem; line-height: 1.4;">${escapeHtml(task.description || 'Card sem descrição')}</div>
    <div class="d-flex gap-2 mb-1 align-items-center pe-4">
      ${assigneeIconBadge(task, color, false)}
      ${complexityBadge(task, false)}
      ${taskCategoryBadge(task, false)}
      ${taskOrderBadge(task, priorityIndex, false)}
    </div>
    <button type="button" class="impediment-reason-btn" title="${escapeHtml(reason)}" aria-label="Motivo do impedimento: ${escapeHtml(reason)}">!</button>
  </div>`;
}

window.handleAddImpediment = async () => {
  if (!state.impediments[state.currentUser]) state.impediments[state.currentUser] = [];
  state.impediments[state.currentUser].push({ id: generateUUID(), text: '' });
  await saveState();
  renderImpediments();
};

window.handleDeleteImpediment = async (id) => {
  state.impediments[state.currentUser] = (state.impediments[state.currentUser] || []).filter(i => i.id !== id);
  await saveState();
  renderImpediments();
};

window.updateImpediment = (id, val) => {
  const imp = (state.impediments[state.currentUser] || []).find(i => i.id === id);
  if (imp) {
    imp.text = val;
    persistVault(); // Salva sem re-renderizar para manter o foco
  }
};

function renderBurndown() {
    if (!elements.burndownChart || !state.currentUser) return;

    const parseSprintPeriod = () => {
        const fallbackStart = new Date();
        fallbackStart.setHours(0, 0, 0, 0);
        const fallbackEnd = new Date(fallbackStart);
        fallbackEnd.setDate(fallbackStart.getDate() + 15);

        const periodVal = elements.sprintPeriod?.value || "";
        if (!periodVal.includes(' até ')) {
            return { startDate: fallbackStart, endDate: fallbackEnd, totalDays: 15 };
        }

        const [startText, endText] = periodVal.split(' até ');
        const parseDate = (value) => {
            const [day, month, year] = value.split('/').map(Number);
            if (!day || !month) return null;
            const parsed = new Date(year || new Date().getFullYear(), month - 1, day);
            parsed.setHours(0, 0, 0, 0);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };

        const startDate = parseDate(startText);
        const endDate = parseDate(endText);
        if (!startDate || !endDate || endDate <= startDate) {
            return { startDate: fallbackStart, endDate: fallbackEnd, totalDays: 15 };
        }

        const totalDays = Math.max(1, Math.round((endDate - startDate) / 86400000));
        return { startDate, endDate, totalDays };
    };

    const getPoints = (task) => {
        const points = Number.parseInt(task.priority, 10);
        return Number.isFinite(points) ? points : 0;
    };

    const { startDate, totalDays } = parseSprintPeriod();
    const userTasks = state.tasks.filter(task => task.owner === state.currentUser);
    const totalPoints = userTasks.reduce((sum, task) => sum + getPoints(task), 0);
    const donePoints = userTasks
    .filter(task => task.column === 'done')
    .reduce((sum, task) => sum + getPoints(task), 0);

    const remainingPoints = Math.max(totalPoints - donePoints, 0);
    const maxPoints = Math.max(totalPoints, 1);

    const remainingByDay = [];
    const idealByDay = [];
    const now = new Date();

    for (let day = 0; day <= totalDays; day++) {
        const dayEnd = new Date(startDate);
        dayEnd.setDate(startDate.getDate() + day);
        dayEnd.setHours(23, 59, 59, 999);

        const completedPoints = userTasks
            .filter(task => task.column === 'done' && task.completedAt && new Date(task.completedAt) <= dayEnd)
            .reduce((sum, task) => sum + getPoints(task), 0);

        remainingByDay.push(Math.max(totalPoints - completedPoints, 0));
        idealByDay.push(Math.max(totalPoints - (day * (totalPoints / totalDays)), 0));
    }

    const width = 960;
    const height = 260;
    const padding = { top: 24, right: 18, bottom: 32, left: 48 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const xForDay = (day) => padding.left + (day / totalDays) * chartW;
    const yForPoints = (points) => padding.top + chartH - (points / maxPoints) * chartH;
    const pathFor = (series) => series.map((points, day) => `${day === 0 ? 'M' : 'L'} ${xForDay(day).toFixed(2)} ${yForPoints(points).toFixed(2)}`).join(' ');

    const realPath = pathFor(remainingByDay);
    const idealPath = pathFor(idealByDay);
    const areaPath = `${realPath} L ${xForDay(totalDays).toFixed(2)} ${padding.top + chartH} L ${padding.left} ${padding.top + chartH} Z`;

    const dayGridStep = Math.max(1, Math.ceil(totalDays / 8));
    const pointGridStep = Math.max(1, Math.ceil(maxPoints / 4));
    const verticalGrid = [];
    for (let day = 0; day <= totalDays; day += dayGridStep) {
        const x = xForDay(day).toFixed(2);
        verticalGrid.push(`<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartH}" class="burndown-grid" />`);
    }
    if (totalDays % dayGridStep !== 0) {
        const x = xForDay(totalDays).toFixed(2);
        verticalGrid.push(`<line x1="${x}" y1="${padding.top}" x2="${x}" y2="${padding.top + chartH}" class="burndown-grid" />`);
    }

    const horizontalGrid = [];
    for (let points = 0; points <= maxPoints; points += pointGridStep) {
        const y = yForPoints(points).toFixed(2);
        horizontalGrid.push(`<line x1="${padding.left}" y1="${y}" x2="${padding.left + chartW}" y2="${y}" class="burndown-grid" />`);
    }

    const dataPoints = remainingByDay.map((points, day) => {
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + day);
        if (dayDate > now) return '';
        return `<circle cx="${xForDay(day).toFixed(2)}" cy="${yForPoints(points).toFixed(2)}" r="5" class="burndown-point"><title>Dia ${day}: ${points} pts restantes</title></circle>`;
    }).join('');

    elements.burndownChart.innerHTML = `
        <div class="burndown-chart-shell">
            <div class="burndown-remaining-label">${remainingPoints} pts restantes</div>
            <svg class="burndown-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Burndown com ${totalPoints} pontos em ${totalDays} dias">
                <defs>
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.16" />
                        <stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
                    </linearGradient>
                </defs>

                ${verticalGrid.join('')}
                ${horizontalGrid.join('')}

                <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + chartH}" class="burndown-axis" />
                <line x1="${padding.left}" y1="${padding.top + chartH}" x2="${padding.left + chartW}" y2="${padding.top + chartH}" class="burndown-axis" />

                <path d="${areaPath}" class="burndown-area" />
                <path d="${idealPath}" class="burndown-ideal-line" />
                <path d="${realPath}" class="burndown-real-line" />
                ${dataPoints}

                <text x="${padding.left - 10}" y="${padding.top + 4}" class="burndown-axis-text" text-anchor="end">${totalPoints} Total</text>
                <text x="${padding.left - 10}" y="${padding.top + chartH}" class="burndown-axis-text" text-anchor="end">0</text>
                <text x="${padding.left}" y="${padding.top + chartH + 22}" class="burndown-axis-text" text-anchor="middle">0</text>
                <text x="${padding.left + chartW}" y="${padding.top + chartH + 22}" class="burndown-axis-text" text-anchor="middle">${totalDays} Dias</text>
            </svg>
        </div>
    `;
}

// --- Sistema de cores por usuário ---
const userColorPalette = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
  '#a855f7', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
  '#22c55e', '#eab308', '#7c3aed', '#fb923c', '#2dd4bf'
];
const userColorMap = {};

function getUserColor(username) {
  if (!username || username === 'Não atribuído') return '#94a3b8';
  if (userColorMap[username]) return userColorMap[username];
  const usedColors = Object.values(userColorMap);
  const available = userColorPalette.filter(c => !usedColors.includes(c));
  const color = available.length > 0 ? available[0] : userColorPalette[Object.keys(userColorMap).length % userColorPalette.length];
  userColorMap[username] = color;
  return color;
}

function getTaskCategory(categoryValue) {
  return taskCategories.find(category => category.value === categoryValue) || taskCategories[0];
}

function taskCategoryBadge(task, editable = true) {
  const category = getTaskCategory(task.category);
  const clickHandler = editable ? ` onclick="showSelection(this, '${task.id}', 'category')"` : '';
  const clickableClass = editable ? ' badge-clickable' : '';
  return `<span class="badge task-category-badge${clickableClass}" style="background:${category.color}; color:#fff;" title="${escapeHtml(category.label)}"${clickHandler}>${escapeHtml(category.short)}</span>`;
}

function assigneeIconBadge(task, color, editable = true) {
  const assignee = task.assignee || 'Não atribuído';
  const clickHandler = editable ? ` onclick="showSelection(this, '${task.id}', 'assignee')"` : ' onclick="showAssigneeName(this)"';
  return `<span class="badge assignee-icon-badge badge-clickable" style="background:${color}; color:#fff;" title="${escapeHtml(assignee)}"${clickHandler}>👤</span>`;
}

function complexityBadge(task, editable = true) {
  const complexity = task.priority || '0';
  const clickHandler = editable ? ` onclick="showSelection(this, '${task.id}', 'priority')"` : '';
  const clickableClass = editable ? ' badge-clickable' : '';
  return `<span class="badge badge-priority${clickableClass}" title="Complexidade ${escapeHtml(complexity)}"${clickHandler}>🔥 ${escapeHtml(complexity)}</span>`;
}

function taskOrderBadge(task, priorityIndex = 0, editable = true) {
  const clickHandler = editable ? ` onclick="showSelection(this, '${task.id}', 'order')"` : '';
  const clickableClass = editable ? ' badge-clickable' : '';
  return `<span class="badge task-order-badge${clickableClass}" title="Prioridade P${priorityIndex}"${clickHandler}>📌 P${priorityIndex}</span>`;
}

function taskCard(task, priorityIndex = 0) {
  const color = getUserColor(task.assignee);
  return `<div class="card task-card shadow-sm p-3 position-relative" draggable="true" data-task-id="${task.id}" style="border-left: 4px solid ${color}">
    <div class="dropdown position-absolute" style="top:5px; right:5px;">
      <button class="btn btn-link btn-sm p-0 text-muted text-decoration-none" type="button" data-bs-toggle="dropdown" aria-expanded="false" style="font-size: 1.2rem; line-height: 1;">
        ⋮
      </button>
      <ul class="dropdown-menu dropdown-menu-end shadow border-0" style="font-size: 0.8rem; min-width: 100px;">
        <li><button class="dropdown-item py-2" onclick="openEditModal('${task.id}')">✏️ Editar</button></li>
        <li><button class="dropdown-item py-2 text-danger" onclick="deleteTask('${task.id}')">❌ Excluir</button></li>
      </ul>
    </div>
    <div class="fw-bold mb-3 pe-4" onclick="openEditModal('${task.id}')" style="cursor:pointer; font-size: 0.95rem; line-height: 1.4;">${escapeHtml(task.description || 'Clique para descrever a tarefa...')}</div>
    <div class="d-flex gap-2 mb-1 align-items-center">
      ${assigneeIconBadge(task, color)}
      ${complexityBadge(task)}
      ${taskCategoryBadge(task)}
      ${taskOrderBadge(task, priorityIndex)}
    </div>
  </div>`;
}

window.handleAddBacklogTask = async () => {
  state.tasks.push({ 
    id: generateUUID(), 
    owner: state.currentUser, 
    title: '', 
    description: '',
    priority: '0', 
    assignee: 'Não atribuído', 
    category: 'frontend',
    column: 'stories', 
    createdAt: new Date().toISOString() 
  }); 
  await saveState(); 
  renderBoard();
  
  // Opcional: Abrir o modal imediatamente para a nova tarefa
  const newTask = state.tasks[state.tasks.length - 1];
  openEditModal(newTask.id);
};

async function handleCreateTask(e) { 
  // Função legada removida
}
async function handleAddMember(e) { e.preventDefault(); }
async function handleSaveNotes(e) { e.preventDefault(); state.notes[state.currentUser] = elements.notesText.value; await saveState(); showFlash('Notas salvas.'); }
async function handleSaveProductVision(e) { e.preventDefault(); state.productVision[state.currentUser] = elements.productVisionText.value; await saveState(); showFlash('Visão salva.'); }

function showView(v) { 
  document.querySelectorAll('.view-section').forEach(s => s.classList.add('hidden')); 
  document.getElementById(`${v}Section`).classList.remove('hidden'); 
  elements.authButtons.classList.toggle('hidden', v !== 'board' && v !== 'admin'); 
  if (v === 'board') renderBoard(); 
  if (v === 'admin') loadUsers();
}

async function loadUsers() {
  try {
    const res = await apiFetch(`${API_URL}/admin/users`);
    const users = await res.json();
    elements.usersTableBody.innerHTML = users.map(user => `
      <tr>
        <td>${user.id}</td>
        <td><strong>${escapeHtml(user.username)}</strong></td>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="badge ${user.role === 'admin' ? 'bg-warning' : 'bg-info'} text-white">${escapeHtml(user.role === 'admin' ? 'Admin' : user.role)}</span></td>
        <td class="text-end">
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="openManageUserModal(${user.id}, '${escapeHtml(user.username)}', '${escapeHtml(user.role)}')">Gerenciar</button>
            ${user.username !== 'admin' ? `<button class="btn btn-outline-danger" onclick="deleteUser(${user.id})">Remover</button>` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showFlash('Erro ao carregar usuários.', 'danger');
  }
}

window.openManageUserModal = (id, username, role) => {
    document.getElementById('manageUserId').value = id;
    document.getElementById('manageUsername').textContent = username;
    document.getElementById('editUserRole').value = role;
    document.getElementById('resetUserPassword').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('manageUserModal'));
    modal.show();
};

window.generateRandomPassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('resetUserPassword').value = password;
};

window.generateRegisterPassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('registerPassword').value = password;
    document.getElementById('registerConfirmPassword').value = password;
};

window.generateForcePassword = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    document.getElementById('forceNewPassword').value = password;
};

window.submitForcePasswordChange = async () => {
    const password = document.getElementById('forceNewPassword').value;
    if (!password || password.length < 8) return showFlash('A nova senha deve ter no mínimo 8 caracteres.', 'danger');

    try {
        const res = await apiFetch(`${API_URL}/change-password`, {
            method: 'POST',
            body: JSON.stringify({ password })
        });

        if (!res.ok) {
            const data = await res.json();
            return showFlash(data.error || 'Erro ao alterar senha.', 'danger');
        }

        showFlash('Senha alterada com sucesso! Você já pode usar o sistema.', 'success');
        currentVaultPassword = password;
        await persistVault();
        bootstrap.Modal.getInstance(document.getElementById('forceChangePasswordModal')).hide();

        if (state.role === 'admin') elements.adminBtn.classList.remove('hidden');
        showView('board');
    } catch (err) {
        showFlash('Erro ao alterar senha.', 'danger');
    }
};

window.saveUserRole = async () => {
    const id = parseInt(document.getElementById('manageUserId').value);
    const role = document.getElementById('editUserRole').value;
    
    try {
        const res = await apiFetch(`${API_URL}/admin/users/${id}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role })
        });
        
        if (!res.ok) {
            const data = await res.json();
            return showFlash(data.error || 'Erro ao atualizar perfil.', 'danger');
        }
        
        showFlash('Perfil atualizado com sucesso!', 'success');
        await loadUsers();
        bootstrap.Modal.getInstance(document.getElementById('manageUserModal')).hide();
    } catch (err) {
        showFlash('Erro ao atualizar perfil.', 'danger');
    }
};

window.saveUserPassword = async () => {
    const id = parseInt(document.getElementById('manageUserId').value);
    const password = document.getElementById('resetUserPassword').value;
    
    if (!password || password.length < 8) return showFlash('Senha deve ter no mínimo 8 caracteres.', 'danger');

    try {
        const res = await apiFetch(`${API_URL}/admin/users/${id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ password })
        });
        
        if (!res.ok) {
            const data = await res.json();
            return showFlash(data.error || 'Erro ao redefinir senha.', 'danger');
        }
        
        showFlash('Senha redefinida com sucesso!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('manageUserModal')).hide();
    } catch (err) {
        showFlash('Erro ao redefinir senha.', 'danger');
    }
};

window.deleteUser = async (id) => {
  if (!confirm('Tem certeza que deseja remover este usuário?')) return;
  try {
    const res = await apiFetch(`${API_URL}/admin/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        const data = await res.json();
        return showFlash(data.error || 'Erro ao remover usuário.', 'danger');
    }
    showFlash('Usuário removido com sucesso.', 'success');
    await loadUsers();
  } catch (err) {
    showFlash('Erro ao remover usuário.', 'danger');
  }
};
function showFlash(m, t = 'info') { elements.flashContainer.innerHTML = `<div class="alert alert-${t} alert-dismissible fade show shadow-sm" role="alert">${m}<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>`; setTimeout(() => { const a = elements.flashContainer.querySelector('.alert'); if (a) a.remove(); }, 4000); }
function escapeHtml(s) { return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
async function hashPassword(p) {
  if (!window.crypto || !crypto.subtle) {
    let hash = 0;
    for (let i = 0; i < p.length; i++) {
      const char = p.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return 'fallback_hash_' + hash;
  }
  const msg = new TextEncoder().encode(p);
  const hash = await crypto.subtle.digest('SHA-256', msg);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

window.deleteMember = async n => { };
window.deleteTask = async id => { state.tasks = state.tasks.filter(t => t.id !== id); await saveState(); renderBoard(); };

function enableDragAndDrop() {
  document.querySelectorAll('.task-list .task-card, .impediment-card').forEach(c => {
    c.ondragstart = e => {
      e.dataTransfer.effectAllowed = 'move';
      if (c.dataset.taskId) {
        e.dataTransfer.setData('text/plain', c.dataset.taskId);
        e.dataTransfer.setData('text', c.dataset.taskId);
      }
      if (c.dataset.impedimentId) {
        e.dataTransfer.setData('application/x-scrumway-impediment', c.dataset.impedimentId);
      }
      c.classList.add('dragging');
    };
    c.ondragend = () => {
      c.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    };
  });

  document.querySelectorAll('.task-list').forEach(l => {
    l.ondragover = e => {
      e.preventDefault();
      l.classList.add('drag-over');
      // Indicador visual de posição de inserção
      const afterElement = getDragAfterElement(l, e.clientY);
      const dragging = document.querySelector('.task-card.dragging');
      if (!dragging) return;
      if (afterElement == null) {
        l.appendChild(dragging);
      } else {
        l.insertBefore(dragging, afterElement);
      }
    };

    l.ondragleave = (e) => {
      if (!l.contains(e.relatedTarget)) l.classList.remove('drag-over');
    };

    l.ondrop = async e => {
      e.preventDefault();
      l.classList.remove('drag-over');
      const impedimentId = getDraggedImpedimentId(e);
      if (impedimentId) {
        await restoreImpedimentToTask(impedimentId, l.dataset.column);
        return;
      }

      const taskId = getDraggedTaskId(e);
      const t = state.tasks.find(t => t.id === taskId);
      if (!t) return;

      const oldCol = t.column;
      t.column = l.dataset.column;

      if (t.column === 'done' && oldCol !== 'done') t.completedAt = new Date().toISOString();
      else if (t.column !== 'done') delete t.completedAt;

      // Recalcula ordem baseado na posição visual atual dos cards
      const cards = [...l.querySelectorAll('.task-card')];
      const userTasks = state.tasks.filter(tk => tk.owner === state.currentUser && tk.column === l.dataset.column);
      cards.forEach((card, idx) => {
        const tk = userTasks.find(tk => tk.id === card.dataset.taskId);
        if (tk) tk.order = idx;
      });

      await saveState();
      renderBoard();
    };
  });

  const impedimentsArea = document.getElementById('impedimentsContainer');
  const impedimentsDropZone = document.querySelector('.footer-item.impediments');
  if (impedimentsArea && impedimentsDropZone) {
    const setImpedimentsDragState = active => {
      impedimentsDropZone.classList.toggle('drag-over', active);
      impedimentsArea.classList.toggle('drag-over', active);
    };

    const handleImpedimentsDragOver = e => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setImpedimentsDragState(true);
    };

    const handleImpedimentsDragLeave = e => {
      if (!impedimentsDropZone.contains(e.relatedTarget)) setImpedimentsDragState(false);
    };

    const handleImpedimentsDrop = async e => {
      e.preventDefault();
      e.stopPropagation();
      setImpedimentsDragState(false);
      if (getDraggedImpedimentId(e)) return;

      const taskId = getDraggedTaskId(e);
      const t = state.tasks.find(task => task.id === taskId);
      if (!t) return;

      openImpedimentReasonModal(t);
    };

    [impedimentsDropZone, impedimentsArea].forEach(target => {
      target.ondragover = handleImpedimentsDragOver;
      target.ondragleave = handleImpedimentsDragLeave;
      target.ondrop = handleImpedimentsDrop;
    });
  }
}

function getDraggedTaskId(e) {
  return e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text');
}

function getDraggedImpedimentId(e) {
  return e.dataTransfer.getData('application/x-scrumway-impediment');
}

function openImpedimentReasonModal(task) {
  pendingImpedimentTaskId = task.id;
  const taskIdInput = document.getElementById('impedimentTaskId');
  const taskPreview = document.getElementById('impedimentTaskPreview');
  const reasonInput = document.getElementById('impedimentReasonText');

  if (!taskIdInput || !taskPreview || !reasonInput || !impedimentReasonModal) {
    createImpedimentFromTask(task.id, 'Impedimento criado a partir da tarefa');
    return;
  }

  taskIdInput.value = task.id;
  taskPreview.textContent = task.description || task.title || 'Card sem descrição';
  reasonInput.value = '';
  impedimentReasonModal.show();
  setTimeout(() => reasonInput.focus(), 150);
}

async function handleSaveImpedimentReason(e) {
  e.preventDefault();
  const taskId = document.getElementById('impedimentTaskId').value;
  const reason = document.getElementById('impedimentReasonText').value.trim();
  if (!taskId || !reason) return;

  pendingImpedimentTaskId = null;
  await createImpedimentFromTask(taskId, reason);
  if (impedimentReasonModal) impedimentReasonModal.hide();
}

async function createImpedimentFromTask(taskId, reason) {
  const task = state.tasks.find(task => task.id === taskId);
  if (!task) return;

  if (!state.impediments[state.currentUser]) state.impediments[state.currentUser] = [];
  state.impediments[state.currentUser].push({
    id: generateUUID(),
    text: reason,
    task: { ...task }
  });

  state.tasks = state.tasks.filter(task => task.id !== taskId);
  await saveState();
  renderBoard();
}

async function restoreImpedimentToTask(impedimentId, column) {
  const impediments = state.impediments[state.currentUser] || [];
  const impediment = impediments.find(item => item.id === impedimentId);
  if (!impediment) return;

  const restoredTask = impediment.task
    ? { ...impediment.task }
    : {
        id: generateUUID(),
        owner: state.currentUser,
        title: '',
        description: impediment.text || '',
        priority: '0',
        assignee: 'Não atribuído',
        category: 'frontend',
        createdAt: new Date().toISOString()
      };

  restoredTask.column = column;
  restoredTask.owner = state.currentUser;
  restoredTask.order = state.tasks.filter(task => task.owner === state.currentUser && task.column === column).length;
  if (column === 'done') restoredTask.completedAt = new Date().toISOString();
  else delete restoredTask.completedAt;

  state.tasks.push(restoredTask);
  state.impediments[state.currentUser] = impediments.filter(item => item.id !== impedimentId);
  await saveState();
  renderBoard();
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

window.showAssigneeName = el => {
  const popup = document.getElementById('selectionPopup');
  popup.innerHTML = '';
  const current = document.createElement('div');
  current.className = 'selection-current';
  current.textContent = `Atribuído: ${el.getAttribute('title') || 'Não atribuído'}`;
  popup.appendChild(current);
  const r = el.getBoundingClientRect();
  popup.style.left = `${r.left + window.scrollX}px`;
  popup.style.top = `${r.bottom + window.scrollY + 5}px`;
  popup.classList.add('visible');
};

window.showSelection = async (el, id, f) => {
  const popup = document.getElementById('selectionPopup');
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (f === 'assignee') await refreshSystemUsers();
  const columnTasks = state.tasks
    .filter(item => item.owner === state.currentUser && item.column === task.column)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const opts = f === 'assignee'
    ? [{ label: 'Não atribuído', value: 'Não atribuído' }, ...systemUsers.map(u => ({ label: u.username, value: u.username }))]
    : f === 'order'
      ? columnTasks.map((_, index) => ({ label: `P${index}`, value: String(index) }))
      : f === 'category'
        ? taskCategories.map(category => ({ label: `${category.label} (${category.short})`, value: category.value }))
        : fibonacci.map(n => ({ label: String(n), value: String(n) }));
  popup.innerHTML = '';
  if (f === 'assignee' || f === 'priority' || f === 'order' || f === 'category') {
    const current = document.createElement('div');
    current.className = 'selection-current';
    const currentOrder = columnTasks.findIndex(item => item.id === task.id);
    current.textContent = f === 'assignee'
      ? `Atribuído: ${task.assignee || 'Não atribuído'}`
      : f === 'order'
        ? `Prioridade atual: P${Math.max(0, currentOrder)}`
        : f === 'category'
          ? `Categoria atual: ${getTaskCategory(task.category).label}`
          : `Complexidade atual: ${task.priority || '0'}`;
    popup.appendChild(current);
  }
  opts.forEach(o => {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.onclick = async () => {
      if (f === 'order') reorderTask(task, Number(o.value));
      else task[f] = o.value;
      await saveState();
      renderBoard();
      popup.classList.remove('visible');
    };
    popup.appendChild(b);
  });
  const r = el.getBoundingClientRect(); popup.style.left = `${r.left + window.scrollX}px`; popup.style.top = `${r.bottom + window.scrollY + 5}px`; popup.classList.add('visible');
};

function reorderTask(task, targetIndex) {
  const columnTasks = state.tasks
    .filter(item => item.owner === state.currentUser && item.column === task.column)
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const currentIndex = columnTasks.findIndex(item => item.id === task.id);
  if (currentIndex < 0) return;

  const [movedTask] = columnTasks.splice(currentIndex, 1);
  columnTasks.splice(Math.max(0, Math.min(targetIndex, columnTasks.length)), 0, movedTask);
  columnTasks.forEach((item, index) => { item.order = index; });
}

function toggleSelectionPopup(s) { document.getElementById('selectionPopup').classList.toggle('visible', s); }

window.openEditModal = async id => {
  const t = state.tasks.find(t => t.id === id); if (!t) return;
  document.getElementById('editTaskId').value = t.id; 
  document.getElementById('editTaskDescription').value = t.description; 
  document.getElementById('editTaskPriority').value = t.priority; 
  document.getElementById('editTaskColumn').value = t.column;
  await refreshSystemUsers();
  const s = document.getElementById('editTaskAssignee'); s.innerHTML = `<option value="Não atribuído">Não atribuído</option>` + systemUsers.map(u => `<option value="${u.username}">${u.username}</option>`).join(''); s.value = t.assignee;
  const categorySelect = document.getElementById('editTaskCategory');
  categorySelect.innerHTML = taskCategories.map(category => `<option value="${category.value}">${category.label} (${category.short})</option>`).join('');
  categorySelect.value = getTaskCategory(t.category).value;
  if (editModal) editModal.show();
};

document.getElementById('editTaskForm').onsubmit = async e => {
  e.preventDefault(); const t = state.tasks.find(t => t.id === document.getElementById('editTaskId').value);
  if (t) { 
    t.description = document.getElementById('editTaskDescription').value; 
    t.priority = document.getElementById('editTaskPriority').value; 
    const oldCol = t.column;
    t.column = document.getElementById('editTaskColumn').value; 
    t.assignee = document.getElementById('editTaskAssignee').value; 
    t.category = document.getElementById('editTaskCategory').value;
    if (t.column === 'done' && oldCol !== 'done') t.completedAt = new Date().toISOString();
    else if (t.column !== 'done') delete t.completedAt;
    await saveState(); renderBoard(); if (editModal) editModal.hide(); 
  }
};

function adjustPriority(d) { const i = document.getElementById('editTaskPriority'); const u = [...new Set(fibonacci)]; const idx = u.indexOf(Number(i.value)); i.value = u[Math.max(0, Math.min(u.length - 1, (idx < 0 ? 0 : idx) + d))]; }
function toggleTheme() { 
  const d = document.body.classList.toggle('dark'); 
  localStorage.setItem('scrumway_theme', d ? 'dark' : 'light'); 
  if (elements.btnTheme) elements.btnTheme.textContent = d ? '☀️' : '🌙'; 
}

function exportData() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
  const a = document.createElement('a'); a.href = dataStr; a.download = `scrumway_backup_${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove();
}

function importData(event) {
  const file = event.target.files[0]; if (!file) return; const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const imp = JSON.parse(e.target.result);
      const importedTasks = Array.isArray(imp)
        ? imp
        : (Array.isArray(imp.tasks) ? imp.tasks
        : (Array.isArray(imp.tarefas) ? imp.tarefas
        : (Array.isArray(imp.cards) ? imp.cards
        : (Array.isArray(imp.items) ? imp.items : null))));
      if (!importedTasks) throw new Error('Nenhuma lista de tarefas encontrada');

      const currentUser = state.currentUser;
      const currentRole = state.role;
      const sourceUser = (!Array.isArray(imp) && typeof imp.currentUser === 'string' && imp.currentUser.trim()) ? imp.currentUser.trim() : currentUser;
      const mapImportedUser = (value) => {
        const user = typeof value === 'string' ? value.trim() : '';
        return (!user || user === sourceUser) ? currentUser : user;
      };
      const remapUserObject = (obj) => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
        const next = { ...obj };
        if (Object.prototype.hasOwnProperty.call(next, sourceUser)) {
          next[currentUser] = next[sourceUser];
          if (sourceUser !== currentUser) delete next[sourceUser];
        }
        return next;
      };

      // Sanitize Tasks
      const normalizeColumn = (value) => {
        const col = String(value || 'stories').toLowerCase().trim();
        const aliases = {
          backlog: 'stories', sprint_backlog: 'stories', stories: 'stories', historia: 'stories', historias: 'stories',
          todo: 'todo', fazer: 'todo', a_fazer: 'todo', 'a fazer': 'todo',
          doing: 'inprogress', in_progress: 'inprogress', inprogress: 'inprogress', fazendo: 'inprogress',
          review: 'review', revisao: 'review', revisão: 'review',
          done: 'done', feito: 'done', concluido: 'done', concluído: 'done'
        };
        return columns.includes(col) ? col : (aliases[col] || 'stories');
      };

      const sanitizedTasks = importedTasks.map(t => ({
        id: (typeof t.id === 'string' && /^[a-zA-Z0-9-]+$/.test(t.id)) ? t.id : generateUUID(),
        owner: mapImportedUser(t.owner),
        title: typeof t.title === 'string' ? t.title : (typeof t.titulo === 'string' ? t.titulo : ''),
        description: typeof t.description === 'string' ? t.description : (typeof t.descricao === 'string' ? t.descricao : (typeof t.descrição === 'string' ? t.descrição : (typeof t.text === 'string' ? t.text : (typeof t.name === 'string' ? t.name : '')))),
        priority: String(t.priority ?? t.prioridade ?? t.story_points ?? t.points ?? '0'),
        assignee: typeof t.assignee === 'string' ? t.assignee : (typeof t.responsavel === 'string' ? t.responsavel : (typeof t.responsável === 'string' ? t.responsável : 'Não atribuído')),
        column: normalizeColumn(t.column ?? t.coluna ?? t.status),
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
        completedAt: typeof t.completedAt === 'string' ? t.completedAt : undefined,
        order: Number.isFinite(Number(t.order)) ? Number(t.order) : undefined
      }));

      // Sanitize DoD
      const sanitizedDod = {};
      if (imp.dod && typeof imp.dod === 'object') {
        for (const [user, list] of Object.entries(imp.dod)) {
          if (Array.isArray(list)) {
            sanitizedDod[mapImportedUser(user)] = list.map(item => ({
              id: (typeof item.id === 'string' && /^[a-zA-Z0-9-]+$/.test(item.id)) ? item.id : generateUUID(),
              text: typeof item.text === 'string' ? item.text : ''
            }));
          }
        }
      }

      // Sanitize Impediments
      const sanitizedImpediments = {};
      if (imp.impediments && typeof imp.impediments === 'object') {
        for (const [user, list] of Object.entries(imp.impediments)) {
          if (Array.isArray(list)) {
            sanitizedImpediments[mapImportedUser(user)] = list.map(item => ({
              id: (typeof item.id === 'string' && /^[a-zA-Z0-9-]+$/.test(item.id)) ? item.id : generateUUID(),
              text: typeof item.text === 'string' ? item.text : ''
            }));
          }
        }
      }

      // Build sanitized state
      state = {
        ...defaultState,
        currentUser,
        role: currentRole,
        tasks: sanitizedTasks,
        dod: sanitizedDod,
        impediments: sanitizedImpediments,
        sprintGoal: remapUserObject(imp.sprintGoal),
        productVision: remapUserObject(imp.productVision),
        sprintIncrement: remapUserObject(imp.sprintIncrement),
        sprintPeriod: remapUserObject(imp.sprintPeriod),
        notes: remapUserObject(imp.notes)
      };

      await saveState();
      showFlash('Dados restaurados com sucesso!', 'success');
      renderBoard();
      showView('board');
    } catch (err) {
      showFlash('Erro ao importar: O arquivo não é um backup válido.', 'danger');
    }
  };
  reader.readAsText(file);
}
