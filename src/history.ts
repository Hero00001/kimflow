import { historyList, historyEmpty, historySearch, clearHistoryBtn } from './dom';

let historyData: HistoryData = { sessions: [] };
let historyQuery = '';
let onSelectEntry: (entry: HistoryEntry) => void = () => undefined;

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const filtered = query
    ? historyData.sessions.filter((session) => {
        return session.title.toLowerCase().includes(query) || session.text.toLowerCase().includes(query);
      })
    : historyData.sessions;
  historyList.replaceChildren();
  historyEmpty.classList.toggle('hidden', filtered.length > 0);
  for (const entry of filtered) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item';
    const title = document.createElement('span');
    title.className = 'history-item-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'history-item-meta';
    meta.textContent = `${formatRelativeTime(entry.createdAt)} • ${formatDuration(entry.durationMs)}`;
    item.append(title, meta);
    item.addEventListener('click', () => onSelectEntry(entry));
    historyList.appendChild(item);
  }
}

export function setHistoryData(data: HistoryData) {
  historyData = data;
  renderHistory();
}

export function refreshHistory() {
  void window.api.getHistory().then((data) => {
    historyData = data;
    renderHistory();
  }).catch(() => undefined);
}

export function wireHistory(onSelect: (entry: HistoryEntry) => void) {
  onSelectEntry = onSelect;
  historySearch.addEventListener('input', () => {
    historyQuery = historySearch.value;
    renderHistory();
  });
  clearHistoryBtn.addEventListener('click', () => {
    void window.api.clearHistory().then((data) => {
      historyData = data;
      renderHistory();
    }).catch(() => undefined);
  });
}