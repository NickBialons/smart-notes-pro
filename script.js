import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDi9LTU8COkvHnKMRgoaCpO3TIi6VGYZfE',
  authDomain: 'smart-notes-pro-38a10.firebaseapp.com',
  projectId: 'smart-notes-pro-38a10',
  storageBucket: 'smart-notes-pro-38a10.firebasestorage.app',
  messagingSenderId: '409969370421',
  appId: '1:409969370421:web:c4166a8c1bd3d41314d87c',
  measurementId: 'G-ZGKT8TG22J'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const GUEST_STORAGE_KEY = 'smart_notes_guest_notes';
const THEME_KEY = 'smart_notes_theme';
const GUEST_KEY = 'guest_mode';

const $ = (selector) => document.querySelector(selector);
const isLoginPage = () =>
  location.pathname === '/' ||
  location.pathname.toLowerCase().includes('login') ||
  !!document.querySelector('#loginBtn');

const stopWords = new Set([
  'и','в','во','не','что','он','на','я','с','со','как','а','то','все','она','так','его','но','да','ты','к','у','же',
  'вы','за','бы','по','только','ее','мне','было','вот','от','меня','еще','нет','о','из','ему','теперь','когда','даже',
  'ну','вдруг','ли','если','или','ни','быть','был','него','до','вас','опять','уж','вам','ведь','там','потом','себя',
  'ничего','ей','может','они','тут','где','есть','надо','ней','для','мы','тебя','их','чем','была','сам','чтоб','без',
  'будто','чего','раз','тоже','себе','под','будет','ж','тогда','кто','этот','того','потому','этого','какой','совсем',
  'ним','здесь','этом','один','почти','мой','тем','чтобы','нее','сейчас','были','куда','зачем','всех','никогда','можно',
  'при','наконец','два','об','другой','хоть','после','над','больше','тот','через','эти','нас','про','всего','них'
]);

let notes = [];
let currentUser = null;
let confirmAction = null;
let aiDebounceTimer = null;
let lastAiResult = { summary: '', keywords: [], allTags: [] };

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initConfirmModal();
  isLoginPage() ? setupLoginPage() : setupAppPage();
});

function initTheme() {
  if (localStorage.getItem(THEME_KEY) === 'light') {
    document.body.classList.add('light');
  }
  const toggle = $('#themeToggle');
  if (!toggle) return;

  const updateIcon = () => {
    toggle.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
  };

  toggle.addEventListener('click', () => {
    document.body.classList.toggle('light');
    localStorage.setItem(THEME_KEY, document.body.classList.contains('light') ? 'light' : 'dark');
    updateIcon();
  });

  updateIcon();
}

function setupLoginPage() {
  const email = $('#email');
  const password = $('#password');

  onAuthStateChanged(auth, (user) => user && (location.href = 'app.html'));

  $('#loginBtn').onclick = () =>
    runAuth(() => signInWithEmailAndPassword(auth, email.value.trim(), password.value));

  $('#registerBtn').onclick = () =>
    runAuth(() => createUserWithEmailAndPassword(auth, email.value.trim(), password.value));

  $('#guestModeBtn').onclick = () => {
    localStorage.setItem(GUEST_KEY, 'true');
    location.href = 'app.html';
  };
}

async function runAuth(action) {
  try {
    localStorage.removeItem(GUEST_KEY);
    await action();
    setMessage('Успешная авторизация.', 'success');
    location.href = 'app.html';
  } catch (error) {
    setMessage(getAuthErrorMessage(error), 'error');
  }
}

function setMessage(text, type = '') {
  const box = $('#messageBox');
  const message = $('#gateMessage');
  if (!box || !message) return;

  message.textContent = text;
  box.classList.remove('message-success', 'message-error');
  if (type) box.classList.add(`message-${type}`);
}

function getAuthErrorMessage(error) {
  return {
    'auth/invalid-email': 'Неверный формат email. Пример: example@gmail.com',
    'auth/missing-password': 'Введите пароль.',
    'auth/weak-password': 'Слишком слабый пароль. Используй минимум 6 символов.',
    'auth/email-already-in-use': 'Этот email уже зарегистрирован. Попробуй войти.',
    'auth/invalid-credential': 'Неверный email или пароль.',
    'auth/user-disabled': 'Этот аккаунт отключен.',
    'auth/too-many-requests': 'Слишком много попыток. Попробуй позже.',
    'auth/network-request-failed': 'Ошибка сети. Проверь интернет.',
    'auth/operation-not-allowed': 'Вход по email и паролю не включен в Firebase.'
  }[error?.code] || 'Произошла ошибка. Проверь введённые данные.';
}

function setupAppPage() {
  protectAppPage();

  ['#title', '#content', '#manualTags'].forEach((selector) =>
    $(selector).addEventListener('input', updateLiveAnalysis)
  );
  $('#priority').addEventListener('change', updateLiveAnalysis);

  $('#saveBtn').onclick = saveNote;
  $('#clearBtn').onclick = clearForm;
  $('#exportJsonBtn').onclick = exportJson;
  $('#exportTxtBtn').onclick = exportTxt;

  $('#searchInput').addEventListener('input', renderNotes);
  $('#sortSelect').onchange = renderNotes;
  $('#filterPriority').onchange = renderNotes;

  $('#clearAllBtn').onclick = () => {
    if (!notes.length) return;
    openConfirm(() => {
      notes = [];
      saveCurrentNotes();
      renderNotes();
      updateDashboardStats();
    }, 'Удалить все заметки?');
  };

  $('#logoutTopBtn').onclick = async () => {
    localStorage.removeItem(GUEST_KEY);
    if (auth.currentUser) await signOut(auth);
    location.href = 'login.html';
  };

  updateLiveAnalysis();
  renderNotes();
  updateDashboardStats();
}

function protectAppPage() {
  const guestMode = localStorage.getItem(GUEST_KEY) === 'true';

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (user) {
      notes = readStorage(getUserStorageKey(user.uid));
      await loadCloudNotes();
      return;
    }

    if (guestMode) {
      notes = loadGuestNotes();
      renderNotes();
      updateDashboardStats();
      return;
    }

    location.href = 'login.html';
  });
}

const getUserStorageKey = (uid) => `smart_notes_user_${uid}`;

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || [];
  } catch {
    return [];
  }
}

const writeStorage = (key, data) => localStorage.setItem(key, JSON.stringify(data));
const loadGuestNotes = () => readStorage(GUEST_STORAGE_KEY);

function saveCurrentNotes() {
  if (currentUser?.uid) {
    writeStorage(getUserStorageKey(currentUser.uid), notes);
  } else if (localStorage.getItem(GUEST_KEY) === 'true') {
    writeStorage(GUEST_STORAGE_KEY, notes);
  }
}

async function loadCloudNotes() {
  if (!currentUser) return;

  const snapshot = await getDocs(
    query(collection(db, 'notes'), where('userId', '==', currentUser.uid))
  );

  notes = snapshot.docs.map((item) => ({ firestoreId: item.id, ...item.data() }));
  saveCurrentNotes();
  renderNotes();
  updateDashboardStats();
}

function getTextStats(text) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const sentences = trimmed ? trimmed.split(/[.!?]+/).filter(Boolean).length : 0;

  return {
    words,
    chars: text.length,
    charsNoSpaces: text.replace(/\s/g, '').length,
    sentences,
    paragraphs: trimmed ? trimmed.split(/\n+/).filter(Boolean).length : 0
  };
}

async function fetchAiAnalysis(text, manualTags = '') {
  const customTagsHint = manualTags
    ? `Пользовательские теги: ${manualTags}`
    : 'Пользовательские теги отсутствуют.';

  const prompt = `
Проанализируй заметку и верни строго JSON.

Текст заметки:
${text}

${customTagsHint}

Требования:
- summary: 1-2 коротких предложения
- keywords: 5-6 главных ключевых слов или фраз
- tags: 2-4 коротких тега для поиска
- не используй markdown
- не добавляй ничего кроме JSON
  `.trim();

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });

    const data = await response.json();

    return {
      summary: data.summary || '',
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      tags: Array.isArray(data.tags) ? data.tags : []
    };
  } catch {
    return {
      summary: 'AI-анализ временно недоступен.',
      keywords: [],
      tags: []
    };
  }
}

function updateLiveStats(text) {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const sentences = trimmed ? trimmed.split(/[.!?]+/).filter(Boolean).length : 0;
  const paragraphs = trimmed ? trimmed.split(/\n+/).filter(Boolean).length : 0;
  const avgSentence = sentences ? Math.max(1, Math.round(words / sentences)) : words;

  const liveStats = $('#liveStats');
  if (liveStats) {
    liveStats.innerHTML = `
      <strong>Живая статистика</strong><br>
      Слов: ${words} | Символов: ${chars} | Без пробелов: ${charsNoSpaces}<br>
      Предложений: ${sentences} | Абзацев: ${paragraphs} | Средняя длина предложения: ${avgSentence}
    `;
  }

  return { words, chars, charsNoSpaces, sentences, paragraphs };
}

function setAnalysisLoading() {
  $('#analysisResult').innerHTML = `
    <div class="analysis-box"><h3>Краткое резюме</h3><p>ИИ анализирует текст...</p></div>
    <div class="analysis-box"><h3>Ключевые слова</h3><p>ИИ анализирует текст...</p></div>
    <div class="analysis-box"><h3>Автотеги</h3><p>ИИ анализирует текст...</p></div>
  `;
}

function setAnalysisEmpty() {
  $('#analysisResult').innerHTML = `
    <div class="analysis-box"><h3>Краткое резюме</h3><p>Нет текста для краткого описания.</p></div>
    <div class="analysis-box"><h3>Ключевые слова</h3><p>Недостаточно текста.</p></div>
    <div class="analysis-box"><h3>Автотеги</h3><p>Теги пока не найдены.</p></div>
  `;
}

function renderTags(list, fallback) {
  return list.length
    ? list.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join(' ')
    : fallback;
}

function buildAnalysis(text, manualTags) {
  const stats = getTextStats(text);
  return {
    stats,
    summary: lastAiResult.summary || '',
    keywords: lastAiResult.keywords || [],
    allTags: lastAiResult.allTags || []
  };
}

async function updateLiveAnalysis() {
  const text = $('#content')?.value || '';
  const manualTags = $('#manualTags')?.value || '';
  updateLiveStats(text);

  if (!text.trim() || text.trim().length < 20) {
    setAnalysisEmpty();
    lastAiResult = { summary: '', keywords: [], allTags: [] };
    return;
  }

  clearTimeout(aiDebounceTimer);
  setAnalysisLoading();

  aiDebounceTimer = setTimeout(async () => {
    try {
      const ai = await fetchAiAnalysis(text, manualTags);
      const customTags = manualTags
        ? manualTags.split(',').map(t => t.trim()).filter(Boolean)
        : [];
      const allTags = [...new Set([...(ai.tags || []), ...customTags])];

      lastAiResult = {
        summary: ai.summary || '',
        keywords: ai.keywords || [],
        allTags
      };

      $('#analysisResult').innerHTML = `
        <div class="analysis-box">
          <h3>Краткое резюме</h3>
          <p>${escapeHtml(ai.summary || 'Нет результата')}</p>
        </div>
        <div class="analysis-box">
          <h3>Ключевые слова</h3>
          <p>${renderTags(ai.keywords || [], 'Нет ключевых слов')}</p>
        </div>
        <div class="analysis-box">
          <h3>Автотеги</h3>
          <p>${renderTags(allTags, 'Нет тегов')}</p>
        </div>
      `;
    } catch {
      $('#analysisResult').innerHTML = `
        <div class="analysis-box" style="border-color:rgba(239,68,68,0.3)">
          <h3>Ошибка AI</h3>
          <p>Анализ временно недоступен, но заметку можно сохранить.</p>
        </div>
      `;
    }
  }, 1200);
}

async function saveNote() {
  const title = $('#title').value.trim();
  const content = $('#content').value.trim();
  const priority = $('#priority').value;
  const manualTags = $('#manualTags').value.trim();
  const editId = Number($('#editId').value || 0);

  if (!title || !content) {
    alert('Заполни заголовок и текст.');
    return;
  }

  const analysis = buildAnalysis(content, manualTags);
  const note = {
    id: editId || Date.now(),
    title,
    content,
    priority,
    tags: analysis.allTags,
    summary: analysis.summary,
    keywordList: analysis.keywords,
    stats: analysis.stats,
    createdAt: editId ? getCreatedAt(editId) : new Date().toLocaleString(),
    updatedAt: new Date().toLocaleString(),
    userId: currentUser?.uid || null
  };

  if (editId) {
    const oldNote = notes.find(item => item.id === editId);
    if (oldNote?.firestoreId && currentUser) {
      await updateDoc(doc(db, 'notes', oldNote.firestoreId), note);
    }
    notes = notes.map(item => item.id === editId ? { ...note, firestoreId: oldNote?.firestoreId } : item);
  } else {
    if (currentUser) {
      const ref = await addDoc(collection(db, 'notes'), note);
      note.firestoreId = ref.id;
    }
    notes.unshift(note);
  }

  saveCurrentNotes();
  clearForm();
  renderNotes();
  updateDashboardStats();
}

function getCreatedAt(id) {
  return notes.find(note => note.id === id)?.createdAt || new Date().toLocaleString();
}

function renderNotes() {
  const search = ($('#searchInput')?.value || '').toLowerCase().trim();
  const priorityFilter = $('#filterPriority')?.value || 'все';
  const sort = $('#sortSelect')?.value || 'new';
  const rank = { high: 3, medium: 2, low: 1 };

  let filtered = notes.filter(note => {
    const haystack = `${note.title} ${note.content} ${(note.tags || []).join(' ')} ${note.summary || ''}`.toLowerCase();
    const matchesSearch = search ? haystack.includes(search) : true;
    const matchesPriority = priorityFilter.toLowerCase() !== 'все' ? note.priority === priorityFilter : true;
    return matchesSearch && matchesPriority;
  });

  if (sort === 'new') filtered.sort((a, b) => b.id - a.id);
  if (sort === 'old') filtered.sort((a, b) => a.id - b.id);
  if (sort === 'priority') filtered.sort((a, b) => rank[b.priority] - rank[a.priority]);
  if (sort === 'words') filtered.sort((a, b) => (b.stats?.words || 0) - (a.stats?.words || 0));

  $('#notesGrid').innerHTML = filtered.length
    ? filtered.map(noteCard).join('')
    : `<div class="empty-state">Нет заметок</div>`;
}

function noteCard(note) {
  return `
    <article class="note-card">
      <div class="note-top">
        <div>
          <h3 class="note-title">${escapeHtml(note.title)}</h3>
          <p class="note-meta">${escapeHtml(note.createdAt || '')}<br>${escapeHtml(note.updatedAt || '')}</p>
        </div>
        <span class="priority-badge ${getPriorityClass(note.priority)}">${escapeHtml(note.priority)}</span>
      </div>

      <p class="note-preview">${escapeHtml(note.content)}</p>
      <p class="note-meta"><strong>Резюме:</strong> ${escapeHtml(note.summary || '')}</p>
      <p class="note-stat-line">Слов: ${note.stats?.words || 0} · Символов: ${note.stats?.chars || 0}</p>
      <div class="tags-wrap">${(note.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join(' ')}</div>

      <div class="note-actions">
        <button class="btn btn-secondary" onclick="editNote(${note.id})">Редактировать</button>
        <button class="btn btn-danger" onclick="openDeleteNote(${note.id})">Удалить</button>
      </div>
    </article>
  `;
}

function initConfirmModal() {
  const modal = $('#confirmModal');
  const ok = $('#confirmOkBtn');
  const cancel = $('#confirmCancelBtn');
  if (!modal || !ok || !cancel) return;

  const close = () => {
    modal.hidden = true;
    confirmAction = null;
  };

  cancel.onclick = close;
  modal.addEventListener('click', (event) => {
    if (event.target === modal) close();
  });

  ok.onclick = async () => {
    const action = confirmAction;
    close();
    if (action) await action();
  };
}

function openConfirm(action, message = '') {
  if ($('#confirmText')) $('#confirmText').textContent = message;
  confirmAction = action;
  $('#confirmModal').hidden = false;
}

function openDeleteNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;
  openConfirm(() => deleteNote(id), `Удалить заметку "${note.title}"?`);
}

async function deleteNote(id) {
  const note = notes.find(item => item.id === id);
  if (note?.firestoreId && currentUser) {
    await deleteDoc(doc(db, 'notes', note.firestoreId));
  }
  notes = notes.filter(item => item.id !== id);
  saveCurrentNotes();
  renderNotes();
  updateDashboardStats();
}

function clearForm() {
  ['#title', '#content', '#manualTags', '#editId'].forEach(selector => {
    const el = $(selector);
    if (el) el.value = '';
  });
  $('#priority').value = 'Низкий';
  updateLiveAnalysis();
}

function updateDashboardStats() {
  $('#totalNotes').textContent = notes.length;
  $('#totalWords').textContent = notes.reduce((sum, note) => sum + (note.stats?.words || 0), 0);
}

function exportJson() {
  if (!notes.length) return alert('Нет заметок.');
  downloadFile(JSON.stringify(notes, null, 2), 'smart-notes-export.json', 'application/json');
}

function exportTxt() {
  if (!notes.length) return alert('Нет заметок.');

  const text = notes.map((note, index) => {
    return `${index + 1}. ${note.title}\n${note.priority}\n${note.createdAt}\n${note.updatedAt}\n\n${(note.keywordList || []).join(', ')}\n${(note.tags || []).join(', ')}\n\n${note.summary || ''}\n\n${note.content}`;
  }).join('\n\n------------------------------------------------------------\n\n');

  downloadFile(text, 'smart-notes-export.txt', 'text/plain;charset=utf-8');
}

function downloadFile(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getPriorityClass(priority) {
  return {
    'Высокий': 'priority-high',
    'Средний': 'priority-medium',
    'Низкий': 'priority-low'
  }[priority] || 'priority-low';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function editNote(id) {
  const note = notes.find(item => item.id === id);
  if (!note) return;

  $('#title').value = note.title || '';
  $('#content').value = note.content || '';
  $('#priority').value = note.priority || 'low';
  $('#manualTags').value = (note.tags || []).join(', ');
  $('#editId').value = note.id;
  updateLiveAnalysis();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.editNote = editNote;
window.openDeleteNote = openDeleteNote;
