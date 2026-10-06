import { historyList, historyEmpty, historySearch, clearHistoryBtn, statusError } from './dom';
import { showError } from './status';
import { errorDetails, friendlyError } from './utils';

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
        // Entries come from disk and may be malformed — one corrupt entry
        // must never blank the whole list.
        const title = session?.title || '';
        const text = session?.text || '';
        return title.toLowerCase().includes(query)
          || text.toLowerCase().includes(query)
          || (session?.translation || '').toLowerCase().includes(query);
      })
    : historyData.sessions;
  historyList.replaceChildren();
  historyEmpty.classList.toggle('hidden', filtered.length > 0);
  for (const entry of filtered) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item';
    const textWrap = document.createElement('span');
    textWrap.className = 'history-item-text';
    const title = document.createElement('span');
    title.className = 'history-item-title';
    title.textContent = entry.title;
    textWrap.append(title);
    if (entry.translation) {
      const excerpt = document.createElement('span');
      excerpt.className = 'history-item-translation';
      const preview = entry.translation.length > 80 ? `${entry.translation.slice(0, 80).trimEnd()}…` : entry.translation;
      excerpt.textContent = preview;
      textWrap.append(excerpt);
    }
    const meta = document.createElement('span');
    meta.className = 'history-item-meta';
    meta.textContent = `${formatRelativeTime(entry.createdAt)} • ${formatDuration(entry.durationMs)}${entry.translation ? ' • 🌐' : ''}`;
    item.append(textWrap, meta);
    item.addEventListener('click', () => onSelectEntry(entry));
    historyList.appendChild(item);
  }
}

export function setHistoryData(data: HistoryData) {
  historyData = normalizeHistoryData(data);
  renderHistory();
}

function normalizeHistoryData(data: HistoryData): HistoryData {
  if (data && Array.isArray(data.sessions)) {
    return { sessions: data.sessions.filter((entry) => entry && typeof entry === 'object') };
  }
  return { sessions: [] };
}

function reportHistoryError(error: unknown, fallback: string) {
  const friendly = friendlyError(error, fallback);
  if (friendly) showError(friendly);
  statusError.title = errorDetails(error) ?? '';
}

export function refreshHistory() {
  void window.api.getHistory().then((data) => {
    historyData = normalizeHistoryData(data);
    renderHistory();
  }).catch((error) => reportHistoryError(error, 'Unable to load history'));
}

export function wireHistory(onSelect: (entry: HistoryEntry) => void) {
  onSelectEntry = onSelect;
  historySearch.addEventListener('input', () => {
    historyQuery = historySearch.value;
    renderHistory();
  });
  clearHistoryBtn.addEventListener('click', () => {
    void window.api.clearHistory().then((data) => {
      historyData = normalizeHistoryData(data);
      renderHistory();
    }).catch((error) => reportHistoryError(error, 'Unable to clear history'));
  });
}