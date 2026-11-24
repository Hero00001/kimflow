import { historyList, historyEmpty, historySearch, clearHistoryBtn, statusError } from './dom';
import { showError, showToast } from './status';
import { errorDetails, friendlyError } from './utils';
import { getLanguage, t } from './i18n';

let historyData: HistoryData = { sessions: [] };
let historyQuery = '';

// Two-step confirm state for `#clear-history-btn` (#05): the first click arms
// the button, the second click executes. A 4s timeout or losing focus disarms
// it, so a stray click can never wipe the history on its own.
let clearArmed = false;
let clearArmTimer: number | undefined = undefined;

let onSelectEntry: (entry: HistoryEntry) => void = () => undefined;

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return t('history.seconds', { count: seconds });
  return seconds
    ? t('history.minutesSeconds', { minutes, seconds })
    : t('history.minutes', { count: minutes });
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return t('history.today');
  if (diff < 2 * day) return t('history.yesterday');
  if (diff < 7 * day) return t('history.daysAgo', { count: Math.floor(diff / day) });
  return new Date(timestamp).toLocaleDateString(getLanguage());
}

/** `deepgram · nova-3 · light` — omitting provenance parts that are absent. */
function formatProvenance(entry: HistoryEntry): string {
  return [entry.engine, entry.model, entry.polishMode]
    .filter((part) => typeof part === 'string' && part.length > 0)
    .join(' · ');
}

/** Keep the clear button's label in sync with the armed state. */
function syncClearLabel() {
  clearHistoryBtn.textContent = clearArmed ? t('history.clearConfirm') : t('history.clear');
}

/** Revert the clear button to its plain state (timeout or blur). */
function disarmClear() {
  clearArmed = false;
  if (clearArmTimer !== undefined) {
    clearTimeout(clearArmTimer);
    clearArmTimer = undefined;
  }
  syncClearLabel();
}

/** Copy one history entry's transcript; success/failure surfaces as a toast. */
async function copyEntryText(entry: HistoryEntry) {
  const text = entry.text || '';
  if (!text) return;
  try {
    await window.api.copyText(text);
    showToast(t('toast.copied'));
  } catch {
    showError(t('error.copyTranscript'));
  }
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
  // renderStatic() resets `data-i18n` labels on language change; this keeps
  // the clear button's label consistent with the armed state afterwards.
  syncClearLabel();
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
    const base = `${formatRelativeTime(entry.createdAt)} • ${formatDuration(entry.durationMs)}${entry.translation ? ' • 🌐' : ''}`;
    const provenance = formatProvenance(entry);
    meta.textContent = provenance ? `${base} • ${provenance}` : base;
    // Per-entry copy affordance (#05): a nested text-btn so the entry itself
    // stays the click-to-open target; stopPropagation keeps the copy click
    // (mouse or keyboard) from triggering the open action.
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'text-btn history-item-copy';
    copyBtn.textContent = t('common.copy');
    copyBtn.setAttribute('aria-label', t('history.copyEntryAria'));
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void copyEntryText(entry);
    });
    item.append(textWrap, meta, copyBtn);
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
    return {
      sessions: data.sessions
        .filter((entry) => entry && typeof entry === 'object')
        // Field-level guards (#15): a malformed entry used to render as
        // `undefined` titles, `NaN sec` durations and `Invalid Date`.
        .map((entry) => ({
          ...entry,
          id: typeof entry.id === 'string' || typeof entry.id === 'number' ? entry.id : '',
          title: typeof entry.title === 'string' ? entry.title : '',
          text: typeof entry.text === 'string' ? entry.text : '',
          createdAt: typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
          durationMs: typeof entry.durationMs === 'number' && Number.isFinite(entry.durationMs) && entry.durationMs >= 0 ? entry.durationMs : 0,
          translation: typeof entry.translation === 'string' ? entry.translation : undefined,
          // Provenance (#04): old entries lack these fields; they simply
          // render without the provenance tail instead of erroring.
          engine: typeof entry.engine === 'string' ? entry.engine : undefined,
          model: typeof entry.model === 'string' ? entry.model : undefined,
          polishMode: typeof entry.polishMode === 'string' ? entry.polishMode : undefined,
        })),
    };
  }
  return { sessions: [] };
}

function reportHistoryError(error: unknown, fallbackKey: string) {
  const friendly = friendlyError(error, fallbackKey);
  if (friendly) showError(friendly);
  statusError.title = errorDetails(error) ?? '';
}

export function refreshHistory() {
  void window.api.getHistory().then((data) => {
    historyData = normalizeHistoryData(data);
    renderHistory();
  }).catch((error) => reportHistoryError(error, 'error.loadHistory'));
}

export function wireHistory(onSelect: (entry: HistoryEntry) => void) {
  onSelectEntry = onSelect;
  historySearch.addEventListener('input', () => {
    historyQuery = historySearch.value;
    renderHistory();
  });
  // Two-step confirm (#05): first click arms ("Confirm clear?" label),
  // second click executes. Timeout and blur both disarm.
  clearHistoryBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      syncClearLabel();
      clearArmTimer = window.setTimeout(disarmClear, 4000);
      return;
    }
    disarmClear();
    void window.api.clearHistory().then((data) => {
      historyData = normalizeHistoryData(data);
      renderHistory();
    }).catch((error) => reportHistoryError(error, 'error.clearHistory'));
  });
  clearHistoryBtn.addEventListener('blur', () => {
    if (clearArmed) disarmClear();
  });
}
