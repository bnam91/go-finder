const channelSelect = document.getElementById('channelSelect');
const btnAddChannel = document.getElementById('btnAddChannel');
const btnRunCrawl = document.getElementById('btnRunCrawl');
const keywordInput = document.getElementById('keywordInput');
const crawlLimit = document.getElementById('crawlLimit');
const addChannelModal = document.getElementById('addChannelModal');
const modalChannelName = document.getElementById('modalChannelName');
const modalChannelAlias = document.getElementById('modalChannelAlias');
const modalSpreadsheetId = document.getElementById('modalSpreadsheetId');
const modalError = document.getElementById('modalError');
const modalCancel = document.getElementById('modalCancel');
const modalConfirm = document.getElementById('modalConfirm');
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const captionEl = document.getElementById('caption');
const tableWrap = document.getElementById('tableWrap');
const historySection = document.getElementById('historySection');
const historyList = document.getElementById('historyList');
const thumbPopup = document.getElementById('thumbPopup');
const thumbPopupImg = document.getElementById('thumbPopupImg');
const filterSection = document.getElementById('filterSection');
const filterPickOnly = document.getElementById('filterPickOnly');
const pickCountBadge = document.getElementById('pickCountBadge');
const filterVpf100 = document.getElementById('filterVpf100');
const vpf100CountBadge = document.getElementById('vpf100CountBadge');
const filterViewsMin = document.getElementById('filterViewsMin');
const filterFollowersMin = document.getElementById('filterFollowersMin');
const filterFollowersMax = document.getElementById('filterFollowersMax');

let channels = [];
let selectedChannel = null;
let tableData = [];
let sortState = { col: null, dir: 1 };

function updatePickCount() {
  const count = tableData.filter((r) => r.pick === true).length;
  if (pickCountBadge) pickCountBadge.textContent = String(count);
}

function updateVpf100Count() {
  const count = tableData.filter((r) => {
    const v = parseNum(r.vpf);
    return v != null && v > 100;
  }).length;
  if (vpf100CountBadge) vpf100CountBadge.textContent = String(count);
}

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, ' ');
}

function isImageUrl(s) {
  if (!s || typeof s !== 'string') return false;
  const t = String(s).trim();
  return t.startsWith('http://') || t.startsWith('https://');
}

function formatNumber(val) {
  if (val == null || val === '') return '';
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  if (isNaN(n)) return String(val);
  return Math.floor(n).toLocaleString();
}

function parseNum(val) {
  if (val == null || val === '') return null;
  const s = String(val).replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseDuration(val) {
  if (val == null || val === '') return null;
  const s = String(val).trim();
  const n = parseFloat(s);
  if (!isNaN(n)) return n;
  const parts = s.split(':').map((p) => parseFloat(p.trim()));
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] ?? null;
}

function getSortValue(row, col) {
  if (col === 'duration') return parseDuration(row[col]);
  if (col === 'views' && (row[col] === '조회수 없음' || String(row[col] || '').trim() === '조회수 없음')) return 0;
  return parseNum(row[col]);
}

function sortData(data, col, dir) {
  return [...data].sort((a, b) => {
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);
    if (va == null && vb == null) return 0;
    if (va == null) return dir;
    if (vb == null) return -dir;
    return dir * (va - vb);
  });
}

function applyFilters(data) {
  let filtered = data;
  if (filterPickOnly?.checked) {
    filtered = filtered.filter((r) => r.pick === true);
  }
  if (filterVpf100?.checked) {
    filtered = filtered.filter((r) => {
      const v = parseNum(r.vpf);
      return v != null && v > 100;
    });
  }
  const minV = parseNum(filterViewsMin?.value);
  if (minV != null) {
    filtered = filtered.filter((r) => {
      const v = r.views === '조회수 없음' || String(r.views || '').trim() === '조회수 없음' ? 0 : parseNum(r.views);
      return (v ?? 0) >= minV;
    });
  }
  const minF = parseNum(filterFollowersMin?.value);
  const maxF = parseNum(filterFollowersMax?.value);
  if (minF != null) {
    filtered = filtered.filter((r) => (parseNum(r.followers) ?? 0) >= minF);
  }
  if (maxF != null) {
    filtered = filtered.filter((r) => (parseNum(r.followers) ?? Infinity) <= maxF);
  }
  return filtered;
}

function renderTable(data) {
  if (!data || data.length === 0) {
    tableWrap.innerHTML = '<div class="loading">데이터가 없습니다.</div>';
    tableWrap.classList.remove('hidden');
    filterSection.classList.add('hidden');
    return;
  }
  filterSection.classList.remove('hidden');
  tableData = data;
  updatePickCount();
  updateVpf100Count();
  const filtered = applyFilters(data);
  const sorted = sortState.col ? sortData(filtered, sortState.col, sortState.dir) : filtered;

  const headers = [
    { key: '_select', label: '', sortable: false, isSelect: true },
    { key: 'keyword', label: 'keyword', sortable: false },
    { key: 'thumbnail', label: 'thumbnail', sortable: false },
    { key: 'title', label: 'title', sortable: false },
    { key: 'channel_name', label: 'channel_name', sortable: false },
    { key: 'views', label: 'views', sortable: true },
    { key: 'upload_date', label: 'upload_date', sortable: false },
    { key: 'duration', label: 'duration', sortable: true },
    { key: 'followers', label: 'followers', sortable: true },
    { key: 'vpf', label: 'vpf', sortable: true },
  ];
  let html = '<table><thead><tr>';
  for (const h of headers) {
    const cls = h.isSelect ? 'col-select' : h.key === 'keyword' ? 'col-keyword' : h.key === 'thumbnail' ? 'col-thumb' : h.key === 'title' ? 'col-title' : 'col-default';
        if (h.isSelect) {
          html += `<th class="${cls}"></th>`;
    } else if (h.sortable) {
      const isActive = sortState.col === h.key;
      const upClass = isActive && sortState.dir === 1 ? 'active' : '';
      const downClass = isActive && sortState.dir === -1 ? 'active' : '';
      html += `<th class="${cls} th-sortable" data-sort-col="${escapeHtml(h.key)}" title="클릭하여 정렬">${escapeHtml(h.label)}<span class="sort-arrows"><span class="${upClass}">▲</span><span class="${downClass}">▼</span></span></th>`;
    } else {
      html += `<th class="${cls}">${escapeHtml(h.label)}</th>`;
    }
  }
  html += '</tr></thead><tbody>';
  for (const row of sorted) {
    const docId = row._id ? String(row._id) : '';
    html += '<tr data-doc-id="' + escapeHtml(docId) + '">';
    const pickChecked = row.pick === true ? ' checked' : '';
    html += `<td class="col-select"><input type="checkbox" class="row-select-checkbox" data-doc-id="${escapeHtml(docId)}"${pickChecked} /><button type="button" class="row-delete-btn" title="행 삭제 (Ctrl+클릭)">−</button></td>`;
    html += `<td class="col-keyword">${escapeHtml(row.keyword)}</td>`;
    const thumb = row.thumbnail;
    if (isImageUrl(thumb)) {
      html += `<td class="col-thumb"><img class="thumb-img" src="${escapeHtml(thumb)}" alt="" data-src="${escapeHtml(thumb)}" /></td>`;
    } else {
      html += `<td class="col-thumb">${escapeHtml(thumb)}</td>`;
    }
    const videoLink = row.video_link || '';
    const title = row.title || '';
    if (videoLink && (videoLink.startsWith('http://') || videoLink.startsWith('https://'))) {
      html += `<td class="col-title"><a href="${escapeHtml(videoLink)}" target="_blank" rel="noopener">${escapeHtml(title)}</a></td>`;
    } else {
      html += `<td class="col-title">${escapeHtml(title)}</td>`;
    }
    const viewsStr = row.views === '조회수 없음' || String(row.views || '').trim() === '조회수 없음' ? '조회수 없음' : formatNumber(row.views);
    const followersStr = formatNumber(row.followers);
    html += `<td class="col-default">${escapeHtml(row.channel_name)}</td>`;
    html += `<td class="col-default">${escapeHtml(viewsStr)}</td>`;
    html += `<td class="col-default">${escapeHtml(row.upload_date)}</td>`;
    html += `<td class="col-default">${escapeHtml(row.duration)}</td>`;
    html += `<td class="col-default">${escapeHtml(followersStr)}</td>`;
    html += `<td class="col-default">${escapeHtml(row.vpf)}</td>`;
    html += '</tr>';
  }
  html += '</tbody></table>';
  tableWrap.innerHTML = html;
  tableWrap.classList.remove('hidden');

  tableWrap.querySelectorAll('.th-sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.sortCol;
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 1 ? -1 : 1;
      } else {
        sortState.col = col;
        sortState.dir = 1;
      }
      renderTable(tableData);
    });
  });

  const toggleRowSelected = (checkbox) => {
    const tr = checkbox.closest('tr');
    if (tr) tr.classList.toggle('row-selected', checkbox.checked);
  };

  tableWrap.querySelectorAll('.row-select-checkbox').forEach((cb) => {
    cb.addEventListener('change', async () => {
      toggleRowSelected(cb);
      const docId = cb.dataset.docId;
      if (!docId || !selectedChannel) return;
      const res = await window.api.updateDocumentPick(selectedChannel, docId, cb.checked);
      if (res?.ok) {
        const row = tableData.find((r) => String(r._id) === docId);
        if (row) row.pick = cb.checked;
        updatePickCount();
      } else {
        cb.checked = !cb.checked;
        toggleRowSelected(cb);
      }
    });
  });

  const handleDeleteClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const tr = e.target.closest('tr');
    const docId = tr?.dataset?.docId;
    if (!docId || !selectedChannel?.mongo?.keywordsCollection) return;
    try {
      const res = await window.api.deleteDocumentById(selectedChannel, docId);
      if (res?.ok && res?.deletedCount > 0) {
        tableData = tableData.filter((r) => String(r._id) !== docId);
        tr.remove();
        updatePickCount();
        const match = captionEl.textContent.match(/(.+총\s*)(\d+)(건)/);
        if (match) captionEl.textContent = match[1] + tableData.length + match[3];
      } else {
        alert(res?.error || '삭제 실패');
      }
    } catch (err) {
      alert('삭제 오류: ' + (err?.message || err));
    }
  };

  tableWrap.querySelectorAll('.row-delete-btn').forEach((btn) => {
    btn.addEventListener('click', handleDeleteClick);
    btn.addEventListener('contextmenu', handleDeleteClick);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Control') document.body.classList.add('ctrl-pressed');
});
document.addEventListener('keyup', (e) => {
  if (e.key === 'Control') document.body.classList.remove('ctrl-pressed');
});

tableWrap.addEventListener('mousedown', (e) => {
  const img = e.target.closest('.col-thumb img.thumb-img');
  if (img?.src) {
    e.preventDefault();
    thumbPopupImg.src = img.dataset.src || img.src;
    thumbPopup.classList.add('show');
  }
});
tableWrap.addEventListener('touchstart', (e) => {
  const img = e.target.closest('.col-thumb img.thumb-img');
  if (img?.src) {
    thumbPopupImg.src = img.dataset.src || img.src;
    thumbPopup.classList.add('show');
  }
}, { passive: true });
const hideThumbPopup = () => {
  thumbPopup.classList.remove('show');
};
document.addEventListener('mouseup', hideThumbPopup);
document.addEventListener('touchend', hideThumbPopup);

function setupFilterListeners() {
  filterPickOnly?.addEventListener('change', () => tableData.length && renderTable(tableData));
  filterVpf100?.addEventListener('change', () => tableData.length && renderTable(tableData));
  filterViewsMin?.addEventListener('input', () => tableData.length && renderTable(tableData));
  filterFollowersMin?.addEventListener('input', () => tableData.length && renderTable(tableData));
  filterFollowersMax?.addEventListener('input', () => tableData.length && renderTable(tableData));
}

async function loadChannels() {
  const res = await window.api.getChannels();
  if (!res.ok) {
    errorEl.textContent = '채널 목록 오류: ' + res.error;
    errorEl.classList.remove('hidden');
    return;
  }
  channels = res.data || [];
  channelSelect.innerHTML = '<option value="">-- 채널 선택 --</option>';
  for (const ch of channels) {
    const opt = document.createElement('option');
    opt.value = ch.channel_name;
    opt.textContent = `${ch.channel_name} (${ch.channel_alias || '-'})`;
    channelSelect.appendChild(opt);
  }
}

async function onChannelChange() {
  const val = channelSelect.value;
  historySection.classList.add('hidden');
  filterSection.classList.add('hidden');
  tableWrap.classList.add('hidden');
  loadingEl.textContent = '채널을 선택한 뒤 히스토리에서 키워드를 선택하세요.';
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');

  if (!val) {
    selectedChannel = null;
    return;
  }
  selectedChannel = channels.find(c => c.channel_name === val);
  if (!selectedChannel) return;

  try {
    const res = await window.api.getKeywordHistory(selectedChannel);
    loadingEl.classList.add('hidden');
    if (res.ok && res.data?.length > 0) {
      historySection.classList.remove('hidden');
      historyList.innerHTML = '';
      for (const kw of res.data) {
        const el = document.createElement('span');
        el.className = 'history-item';
        el.dataset.keyword = kw;
        el.innerHTML = `<span class="history-item-text">${escapeHtml(kw)}</span><button type="button" class="history-item-x" title="삭제">×</button>`;
        el.querySelector('.history-item-text').addEventListener('click', () => loadKeywordData(kw));
        el.querySelector('.history-item-x').addEventListener('click', (e) => {
          e.stopPropagation();
          deleteKeywordFromHistory(kw, el);
        });
        historyList.appendChild(el);
      }
    } else if (res.ok) {
      loadingEl.textContent = '이 채널에 저장된 키워드가 없습니다.';
      loadingEl.classList.remove('hidden');
    } else {
      errorEl.textContent = '히스토리 오류: ' + res.error;
      errorEl.classList.remove('hidden');
    }
  } catch (e) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = '오류: ' + (e.message || e);
    errorEl.classList.remove('hidden');
  }
}

async function deleteKeywordFromHistory(keyword, el) {
  if (!selectedChannel) return;
  if (!confirm(`"${keyword}" 키워드 데이터를 MongoDB에서 삭제할까요?`)) return;
  try {
    const res = await window.api.deleteKeywordData(selectedChannel, keyword);
    if (res.ok) {
      el.remove();
      if (!tableWrap.classList.contains('hidden') && captionEl.textContent.includes(keyword)) {
        tableWrap.classList.add('hidden');
        filterSection.classList.add('hidden');
        loadingEl.textContent = '채널을 선택한 뒤 히스토리에서 키워드를 선택하세요.';
        loadingEl.classList.remove('hidden');
      }
      if (historyList.children.length === 0) {
        historySection.classList.add('hidden');
        loadingEl.textContent = '이 채널에 저장된 키워드가 없습니다.';
        loadingEl.classList.remove('hidden');
      }
    } else {
      alert('삭제 오류: ' + res.error);
    }
  } catch (e) {
    alert('삭제 오류: ' + (e.message || e));
  }
}

async function loadKeywordData(keyword) {
  if (!selectedChannel) return;

  loadingEl.textContent = `"${keyword}" 불러오는 중…`;
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  tableWrap.classList.add('hidden');

  try {
    const [res, dateRes] = await Promise.all([
      window.api.loadKeywordData(selectedChannel, keyword),
      window.api.getKeywordCrawlDate(selectedChannel, keyword),
    ]);
    loadingEl.classList.add('hidden');
    if (res.ok) {
      let caption = `키워드: ${keyword} · 총 ${res.data.length}건`;
      if (dateRes?.ok && dateRes?.date) caption += ` · 검색일: ${dateRes.date}`;
      captionEl.textContent = caption;
      renderTable(res.data);
    } else {
      errorEl.textContent = '오류: ' + res.error;
      errorEl.classList.remove('hidden');
    }
  } catch (e) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = '오류: ' + (e.message || e);
    errorEl.classList.remove('hidden');
  }
}

channelSelect.addEventListener('change', onChannelChange);

btnRunCrawl.addEventListener('click', async () => {
  const channelVal = channelSelect.value;
  if (!channelVal) {
    errorEl.textContent = '채널을 선택하세요.';
    errorEl.classList.remove('hidden');
    return;
  }
  const channel = channels.find(c => c.channel_name === channelVal);
  if (!channel) return;

  const outputVal = document.getElementById('outputSelect')?.value || 'mongo';
  const output = {
    mongo: outputVal === 'mongo' ? 1 : 0,
    spreadsheet: outputVal === 'spreadsheet' ? 1 : 0,
    json: outputVal === 'json' ? 1 : 0,
  };
  const searchTab = Number(document.getElementById('searchTabSelect')?.value || 3);
  const titleFilter = document.getElementById('titleFilterSelect')?.value || 'n';
  const headless = document.getElementById('headlessCheckbox')?.checked ?? false;

  btnRunCrawl.disabled = true;
  loadingEl.innerHTML = `<div class="loading-spinner"><span class="spinner"></span><span>크롤링 중… ${headless ? '(백그라운드)' : '(브라우저 창이 열립니다)'}</span></div>`;
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  tableWrap.classList.add('hidden');

  try {
    const res = await window.api.runCrawl({
      channelConfig: channel,
      output,
      searchTab,
      keywordsInput: keywordInput.value.trim(),
      crawlLimit: crawlLimit.value,
      titleFilter,
      headless,
    });
    btnRunCrawl.disabled = false;
    loadingEl.classList.add('hidden');
    if (res.ok) {
      selectedChannel = channel;
      await onChannelChange();
      if (res.keywords?.length > 0) {
        historySection.classList.remove('hidden');
        const firstKw = res.keywords[0];
        await loadKeywordData(firstKw);
      }
    } else {
      errorEl.textContent = '오류: ' + (res.error || '알 수 없음');
      errorEl.classList.remove('hidden');
    }
  } catch (e) {
    btnRunCrawl.disabled = false;
    loadingEl.classList.add('hidden');
    errorEl.textContent = '오류: ' + (e.message || e);
    errorEl.classList.remove('hidden');
  }
});

btnAddChannel.addEventListener('click', () => {
  modalChannelName.value = '';
  modalChannelAlias.value = '';
  modalSpreadsheetId.value = '';
  modalError.textContent = '';
  addChannelModal.classList.add('show');
  modalChannelName.focus();
});

modalCancel.addEventListener('click', () => {
  addChannelModal.classList.remove('show');
});

modalConfirm.addEventListener('click', async () => {
  const channel_name = modalChannelName.value.trim();
  const channel_alias = (modalChannelAlias.value.trim() || channel_name).toLowerCase();
  const spreadsheetId = modalSpreadsheetId.value.trim();

  modalError.textContent = '';
  if (!channel_name) {
    modalError.textContent = '채널명을 입력하세요.';
    return;
  }
  if (!channel_alias) {
    modalError.textContent = '채널 별칭을 입력하세요.';
    return;
  }

  const keywordsCollection = `gotrap_keywords_${channel_alias}`;
  const takenRes = await window.api.isKeywordsCollectionTaken(keywordsCollection);
  if (takenRes.ok && takenRes.taken) {
    modalError.textContent = `'${keywordsCollection}' 컬렉션은 이미 사용 중입니다. 다른 별칭을 입력하세요.`;
    return;
  }

  const doc = {
    channel_name,
    channel_alias,
    spreadsheet: {
      id: spreadsheetId,
      sheets: { keyword: 'keyword', channelId: 'channel_id' },
    },
    mongo: {
      db: '03_project_ytb_gotrap',
      keywordsCollection,
      crawlDatesCollection: 'gotrap_crawl_dates',
    },
  };

  const addRes = await window.api.addChannel(doc);
  if (addRes.ok) {
    addChannelModal.classList.remove('show');
    await loadChannels();
    channelSelect.value = channel_name;
    onChannelChange();
  } else {
    modalError.textContent = '저장 오류: ' + addRes.error;
  }
});

addChannelModal.addEventListener('click', (e) => {
  if (e.target === addChannelModal) addChannelModal.classList.remove('show');
});

setupFilterListeners();
(async () => {
  await loadChannels();
})();
