const CIVILIZATIONS = {
  light: { label: '光', color: '#f0d979' },
  water: { label: '水', color: '#76c7e9' },
  darkness: { label: '闇', color: '#bd8be4' },
  fire: { label: '火', color: '#f28b68' },
  nature: { label: '自然', color: '#a9d277' },
  zero: { label: '無色', color: '#aeb5c0' },
};

const TYPE_LABELS = {
  creature: 'クリーチャー', spell: '呪文', cross_gear: 'クロスギア', castle: '城',
  evolution_creature: '進化クリーチャー', evolution: '進化', artifact: 'アーティファクト',
  treasure: 'タマシード', field: 'フィールド', other: 'その他',
};

const elements = {
  form: document.querySelector('#search-form'),
  name: document.querySelector('#name-query'), text: document.querySelector('#text-query'),
  game: document.querySelector('#game'), costMin: document.querySelector('#cost-min'), costMax: document.querySelector('#cost-max'),
  powerMin: document.querySelector('#power-min'), powerMax: document.querySelector('#power-max'), race: document.querySelector('#race'),
  type: document.querySelector('#type'), rarity: document.querySelector('#rarity'), set: document.querySelector('#set'),
  sort: document.querySelector('#sort'), uniqueNames: document.querySelector('#unique-names'), cards: document.querySelector('#card-list'), count: document.querySelector('#result-count'),
  empty: document.querySelector('#empty-state'), emptyTitle: document.querySelector('#empty-title'), emptyMessage: document.querySelector('#empty-message'),
  dialog: document.querySelector('#card-dialog'), detail: document.querySelector('#card-detail'), error: document.querySelector('#load-error'),
};

let cards = [];
let relatedData = null;
let relatedLoadFailed = false;
const detailHistory = [];
const relationName = value => String(value).normalize('NFKC').replace(/\s+/g, '');
function appendRelatedCards(card) {
  if (card.game !== 'duel_masters_play') return;
  const section = document.createElement('section');
  section.className = 'related-section';
  if (detailHistory.length) {
    const back = document.createElement('button'); back.type = 'button'; back.textContent = '← 前のカードに戻る';
    back.addEventListener('click', () => showDetails(detailHistory.pop(), false)); section.append(back);
  }
  if (relatedLoadFailed) { const warning = document.createElement('p'); warning.textContent = '呼び出し先データを読み込めませんでした。再読み込みしてください。'; section.append(warning); }
  const groups = relatedData?.groups.filter(g => relationName(g.parent) === relationName(card.name)) || [];
  for (const group of groups) {
    const heading = document.createElement('h3');
    heading.textContent = ({outside:'ゲーム外から呼び出せるカード',god:'ゴッドリンク前の構成カード',alternate:'別のカードとして召喚できる形態',forms:"P’Sドロン・ゴー／Vの全形態"})[group.kind]; section.append(heading);
    const grid = document.createElement('div'); grid.className = 'related-grid';
    for (const target of group.targets) {
      const resolved = cards.find(c => String(c.id) === String(target.cardId)) || relatedData.cards.find(c => String(c.id) === String(target.cardId));
      const tile = document.createElement(resolved ? 'button' : 'div'); tile.className = 'related-card';
      if (resolved) { tile.type = 'button'; tile.append(makeArt(resolved)); tile.addEventListener('click', () => { detailHistory.push(card); showDetails(resolved, false); }); }
      const title = document.createElement('strong'); title.textContent = target.name; tile.append(title);
      const status = document.createElement('span'); status.className = target.status === 'unconfirmed' ? 'relation-unconfirmed' : 'relation-confirmed';
      status.textContent = target.status === 'unconfirmed' ? '対応未確認' : '公式テキスト・関連情報で確認'; tile.append(status);
      if (!resolved) { const missing = document.createElement('span'); missing.textContent = '詳細・画像データ未取得'; tile.append(missing); }
      grid.append(tile);
    }
    section.append(grid);
  }
  if (section.childNodes.length) elements.detail.append(section);
}

const PAGE_SIZE = 48;
let currentPage = 1;
let filteredCards = [];
let firstImplementationByName = new Map();

const RARITY_ORDER_FALLBACK = Object.freeze({
  '-': 100, C: 200, UC: 300, R: 400, VR: 500, SR: 600,
  VIC: 700, LEG: 800, KDL: 900, PS: 1000, MAS: 1100, PEX: 1100, MHZ: 1200,
});
function numericOrder(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function implementationDate(card) {
  return numericOrder(card.releaseDate ?? card.official?.release_date);
}
function officialRarityOrder(card) {
  return numericOrder(card.official?.rare_order) ?? RARITY_ORDER_FALLBACK[card.rarity] ?? 0;
}
function officialSpecialRarityOrder(card) {
  return numericOrder(card.official?.sp_rare_order) ?? 0;
}
function compareCardIds(a, b) {
  const idA = String(a.id ?? ''), idB = String(b.id ?? '');
  return idA.localeCompare(idB, 'en', {numeric:true}) || (idA < idB ? -1 : idA > idB ? 1 : 0);
}
function compareImplementationOrder(a, b) {
  const dateA = implementationDate(a), dateB = implementationDate(b);
  if (dateA === null && dateB !== null) return 1;
  if (dateB === null && dateA !== null) return -1;
  if (dateA === null && dateB === null) return compareCardIds(a, b);
  if (dateA !== dateB) return dateB - dateA;
  const rarityDifference = officialRarityOrder(b) - officialRarityOrder(a);
  if (rarityDifference) return rarityDifference;
  const specialDifference = officialSpecialRarityOrder(b) - officialSpecialRarityOrder(a);
  return specialDifference || compareCardIds(a, b);
}
function isNormalVersion(card) {
  const specialOrder = numericOrder(card.official?.sp_rare_order);
  if (specialOrder !== null) return specialOrder === 200;
  return card.official?.special_rarity === '\u30ce\u30fc\u30de\u30eb';
}
function compareFirstImplementation(a, b) {
  const dateA = implementationDate(a), dateB = implementationDate(b);
  if (dateA === null && dateB !== null) return 1;
  if (dateB === null && dateA !== null) return -1;
  if (dateA !== dateB && dateA !== null && dateB !== null) return dateA - dateB;
  return compareCardIds(a, b);
}
function buildFirstImplementationDates(allCards) {
  const firstDates = new Map();
  for (const card of allCards) {
    const name = String(card.name ?? '');
    const date = implementationDate(card);
    if (!firstDates.has(name) || (date !== null && (firstDates.get(name) === null || date < firstDates.get(name)))) {
      firstDates.set(name, date);
    }
  }
  return firstDates;
}
function compareImplementationGroup(a, b, firstDates, direction) {
  const dateA = firstDates.get(a.name) ?? null;
  const dateB = firstDates.get(b.name) ?? null;
  if (dateA === null && dateB !== null) return 1;
  if (dateB === null && dateA !== null) return -1;
  if (dateA !== dateB) return (dateA - dateB) * direction;
  const rarityDifference = officialRarityOrder(b.card) - officialRarityOrder(a.card);
  if (rarityDifference) return rarityDifference;
  const specialDifference = officialSpecialRarityOrder(b.card) - officialSpecialRarityOrder(a.card);
  return specialDifference || compareCardIds(a.card, b.card);
}
function deduplicateExactNames(sortedCards, firstDates = firstImplementationByName, sort = 'implementation-desc') {
  const groups = new Map();
  for (const card of sortedCards) {
    const exactName = String(card.name ?? '');
    if (!groups.has(exactName)) groups.set(exactName, []);
    groups.get(exactName).push(card);
  }
  const groupedCards = [...groups.entries()].map(([name, group]) => {
    const normalVersions = group.filter(isNormalVersion);
    const candidates = normalVersions.length ? normalVersions : group;
    const representative = [...candidates].sort(compareFirstImplementation)[0];
    return {name, card: representative};
  });
  if (sort === 'implementation-desc' || sort === 'implementation-asc') {
    const direction = sort === 'implementation-asc' ? 1 : -1;
    groupedCards.sort((a, b) => compareImplementationGroup(a, b, firstDates, direction));
  }
  return groupedCards.map(group => group.card);
}
function matchesOriginSelection(card, selectedOrigins) {
  return selectedOrigins.length === 0 || selectedOrigins.includes(card.originType || 'unclassified');
}
const COLORED_CIVILIZATIONS = new Set(['light', 'water', 'darkness', 'fire', 'nature']);
function matchesCivilizationTypeSelection(cardCivilizations, selectedTypes) {
  if (!selectedTypes.length) return true;
  const colorCount = cardCivilizations.filter(civ => COLORED_CIVILIZATIONS.has(civ)).length;
  const hasZero = cardCivilizations.includes('zero');
  return selectedTypes.some(type => {
    if (type === 'mono') return colorCount === 1 && !hasZero;
    if (type === 'multi') return colorCount >= 2 && !hasZero;
    if (type === 'zero') return colorCount === 0 && hasZero;
    return false;
  });
}
function updateAdvancedFilterSummary() {
  const status = document.querySelector('#advanced-filter-status');
  if (!status) return;
  const activeCount = document.querySelectorAll('#origin-filter input:checked').length
    + document.querySelectorAll('#civ-count-filter input:checked').length
    + document.querySelectorAll('#excluded-civ-options input:checked').length;
  status.textContent = activeCount ? `適用中 ${activeCount}件` : '未設定';
}
const pager = document.createElement('nav');
pager.className = 'search-pagination';
pager.setAttribute('aria-label', '検索結果のページ切り替え');
elements.cards.after(pager);
function renderPage() {
  const pages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), pages);
  renderCards(filteredCards.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE));
  elements.count.textContent = String(filteredCards.length);
  pager.replaceChildren();
  if (pages <= 1) return;
  const makeButton = (label, page, disabled = false, active = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    button.className = 'page-button' + (active ? ' is-active' : '');
    if (active) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      currentPage = page;
      renderPage();
      elements.cards.scrollIntoView({block:'start', behavior:'smooth'});
    });
    pager.append(button);
  };
  makeButton('前へ', currentPage - 1, currentPage === 1);
  const start = Math.max(1, Math.min(currentPage - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  for (let page = start; page <= end; page++) makeButton(String(page), page, false, page === currentPage);
  const info = document.createElement('span');
  info.className = 'page-info';
  info.textContent = `${currentPage} / ${pages} ページ`;
  pager.append(info);
  makeButton('次へ', currentPage + 1, currentPage === pages);
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja');
}

function displayType(type) { return TYPE_LABELS[type] || type || '—'; }
function civilizationNames(values = []) { return values.map(value => CIVILIZATIONS[value]?.label || value).join('・') || '—'; }
function numericValue(input) { return input.value.trim() === '' ? null : Number(input.value); }

function warnForInvalidCards(data) {
  return data.filter((card, index) => {
    const issues = [];
    if (!card || typeof card !== 'object' || Array.isArray(card)) issues.push('カードデータがオブジェクトではありません');
    else {
      if (!card.id || !card.name) issues.push('id または name がありません（表示対象外）');
      if (card.cost !== undefined && card.cost !== null && !Number.isFinite(card.cost)) issues.push('cost が数値ではありません');
      if (card.power !== undefined && card.power !== null && !Number.isFinite(card.power)) issues.push('power は数値または null にしてください');
      if (card.civilizations !== undefined && !Array.isArray(card.civilizations)) issues.push('civilizations は配列ではありません');
      if (card.races !== undefined && !Array.isArray(card.races)) issues.push('races は配列ではありません');
    }
    if (issues.length) console.warn(`cards.json の ${index + 1} 件目: ${issues.join(' / ')}`, card);
    return !card || typeof card !== 'object' || Array.isArray(card) || !card.id || !card.name;
  });
}

function fillOptions(select, values, compare = (a, b) => String(a).localeCompare(String(b), 'ja', { numeric: true })) {
  const uniqueValues = [...new Set(values.filter(value => value !== undefined && value !== null && value !== ''))]
    .sort(compare);
  for (const value of uniqueValues) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    select.append(option);
  }
}

function populateOptions() {
  fillOptions(elements.type, cards.map(card => card.type));
  const rarityOrder = ['PEX', 'MHZ', 'MAS', 'KDL', 'LEG', 'VIC', 'PS', 'SR', 'VR', 'R', 'UC', 'C'];
  const rank = rarity => rarityOrder.includes(rarity) ? rarityOrder.indexOf(rarity) : rarityOrder.length;
  fillOptions(elements.rarity, cards.map(card => card.rarity), (a, b) => rank(a) - rank(b));
  fillOptions(elements.set, cards.map(card => card.set));
}

// 既存の検索フォームを変更せず、追加検索条件を自動挿入する。
function setupAdvancedFilters() {
  const target = document.querySelector('#civilizations');
  if (!target || document.querySelector('#advanced-card-filters')) return;
  const wrapper = document.createElement('details');
  wrapper.id = 'advanced-card-filters';
  wrapper.className = 'advanced-card-filters';
  wrapper.innerHTML = `
    <summary class="advanced-summary">
      <span class="advanced-summary-title">詳細な絞り込み</span>
      <span class="advanced-filter-status" id="advanced-filter-status">未設定</span>
    </summary>
    <div class="advanced-filter-content" id="advanced-filter-content">
      <div class="advanced-filter-grid">
        <fieldset class="advanced-choice-group" id="origin-filter">
          <legend>紙版との違い</legend>
          <div class="advanced-choice-options">
            <label class="advanced-choice"><input type="checkbox" value="original"> デュエプレオリジナル</label>
            <label class="advanced-choice"><input type="checkbox" value="modified"> 能力・性能変更あり</label>
            <label class="advanced-choice"><input type="checkbox" value="same"> 紙版と同じ</label>
          </div>
        </fieldset>
        <label>文明の一致方法
          <select id="civ-match-mode">
            <option value="or">OR・いずれかを含む</option>
            <option value="and">AND・すべてを含む</option>
          </select>
        </label>
        <fieldset class="advanced-choice-group" id="civ-count-filter">
          <legend>文明の種類</legend>
          <div class="advanced-choice-options">
            <label class="advanced-choice"><input type="checkbox" value="mono"> 単色</label>
            <label class="advanced-choice"><input type="checkbox" value="multi"> 多色</label>
            <label class="advanced-choice"><input type="checkbox" value="zero"> 無色</label>
          </div>
        </fieldset>
      </div>
      <fieldset class="excluded-civs">
        <legend>含まない文明</legend>
        <div class="advanced-civ-choices" id="excluded-civ-options"></div>
      </fieldset>
    </div>`;
  target.insertAdjacentElement('afterend', wrapper);
  if (!target.querySelector('input[value="zero"]')) {
    const label = document.createElement('label');
    label.className = 'civilization civ-zero';
    const check = document.createElement('input');
    check.type = 'checkbox'; check.value = 'zero'; check.name = 'civilizations';
    const text = document.createElement('span');
    text.textContent = '\u7121\u8272';
    label.append(check, text);
    target.append(label);
  }
  const options = wrapper.querySelector('#excluded-civ-options');
  for (const [key, info] of Object.entries(CIVILIZATIONS)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = key; input.name = 'excluded-civilizations';
    label.append(input, document.createTextNode(` ${info.label}`));
    options.append(label);
  }
}

function normalizedCivilizations(card) {
  const values = Array.isArray(card.civilizations) ? card.civilizations : [];
  // 旧データの無色は []。新データの zero/colorless/無色 にも対応。
  const normalized = values.map(value => ({ colorless: 'zero', 無色: 'zero', none: 'zero' })[value] || value);
  return normalized.length ? normalized : ['zero'];
}

function filterCards() {
  const nameQuery = normalize(elements.name.value.trim());
  const textQuery = normalize(elements.text.value.trim());
  const raceQuery = normalize(elements.race.value.trim());
  const selectedCivilizations = [...document.querySelectorAll('#civilizations input:checked')].map(input => input.value);
  const excludedCivilizations = [...document.querySelectorAll('#excluded-civ-options input:checked')].map(input => input.value);
  const civMatchMode = document.querySelector('#civ-match-mode')?.value || 'or';
  const civCountFilters = [...document.querySelectorAll('#civ-count-filter input:checked')].map(input => input.value);
  const originFilters = [...document.querySelectorAll('#origin-filter input:checked')].map(input => input.value);
  const costMin = numericValue(elements.costMin), costMax = numericValue(elements.costMax);
  const powerMin = numericValue(elements.powerMin), powerMax = numericValue(elements.powerMax);
  updateAdvancedFilterSummary();

  const filtered = cards.filter(card => {
    const cardCivilizations = normalizedCivilizations(card);
    const cardRaces = Array.isArray(card.races) ? card.races : [];
    if (nameQuery && !normalize(card.name).includes(nameQuery)) return false;
    if (textQuery && !normalize(card.text).includes(textQuery)) return false;
    if (elements.game.value && card.game !== elements.game.value) return false;
    if (selectedCivilizations.length && !(civMatchMode === 'and'
      ? selectedCivilizations.every(value => cardCivilizations.includes(value))
      : selectedCivilizations.some(value => cardCivilizations.includes(value)))) return false;
    if (excludedCivilizations.some(value => cardCivilizations.includes(value))) return false;
    if (!matchesCivilizationTypeSelection(cardCivilizations, civCountFilters)) return false;
    if (!matchesOriginSelection(card, originFilters)) return false;
    if (elements.type.value && card.type !== elements.type.value) return false;
    if (elements.rarity.value && String(card.rarity ?? '') !== elements.rarity.value) return false;
    if (elements.set.value && String(card.set ?? '') !== elements.set.value) return false;
    if (raceQuery && !cardRaces.some(race => normalize(race).includes(raceQuery))) return false;
    if (costMin !== null && (!Number.isFinite(card.cost) || card.cost < costMin)) return false;
    if (costMax !== null && (!Number.isFinite(card.cost) || card.cost > costMax)) return false;
    if ((powerMin !== null || powerMax !== null) && !Number.isFinite(card.power)) return false;
    if (powerMin !== null && card.power < powerMin) return false;
    if (powerMax !== null && card.power > powerMax) return false;
    return true;
  });

  const sort = elements.sort.value;
  filtered.sort((a, b) => {
    if (sort === 'implementation-desc') return compareImplementationOrder(a, b);
    if (sort === 'cost-asc') return (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.name.localeCompare(b.name, 'ja');
    if (sort === 'cost-desc') return (b.cost ?? -Infinity) - (a.cost ?? -Infinity) || a.name.localeCompare(b.name, 'ja');
    if (sort === 'power-asc') return (a.power ?? Infinity) - (b.power ?? Infinity) || a.name.localeCompare(b.name, 'ja');
    if (sort === 'power-desc') return (b.power ?? -Infinity) - (a.power ?? -Infinity) || a.name.localeCompare(b.name, 'ja');
    return a.name.localeCompare(b.name, 'ja');
  });
  filteredCards = elements.uniqueNames.checked
    ? deduplicateExactNames(filtered, firstImplementationByName, sort)
    : filtered;
  currentPage = 1;
  renderPage();
}

function makeArt(card, className = 'card-art') {
  const art = document.createElement('div');
  art.className = className;
  if (card.image) {
    const image = document.createElement('img');
    image.src = card.image;
    image.alt = `${card.name}のカード画像`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.remove();
      const placeholder = document.createElement('span');
      placeholder.className = 'art-placeholder';
      placeholder.textContent = 'IMAGE NOT FOUND';
      art.append(placeholder);
    }, { once: true });
    art.append(image);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'art-placeholder';
    placeholder.textContent = 'NO IMAGE';
    art.append(placeholder);
  }
  return art;
}

function renderCards(results) {
  elements.cards.replaceChildren();
  elements.count.textContent = String(filteredCards.length);
  const noData = cards.length === 0;
  elements.empty.hidden = filteredCards.length > 0;
  elements.emptyTitle.textContent = noData ? 'カードが登録されていません。' : '条件に一致するカードがありません。';
  elements.emptyMessage.textContent = noData ? 'data/cards.json にカードデータを追加すると、ここに表示されます。' : '検索条件を変えるか、条件をリセットしてください。';

  for (const card of results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card-tile';
    button.setAttribute('aria-label', `${card.name}の詳細を表示`);
    button.append(makeArt(card));


    const body = document.createElement('div');
    body.className = 'tile-body';
    const title = document.createElement('h3');
    title.className = 'tile-title';
    title.textContent = card.name;
    const meta = document.createElement('div');
    meta.className = 'tile-meta';
    const cost = document.createElement('span');
    cost.textContent = card.cost === null || card.cost === undefined ? 'コスト —' : `コスト ${card.cost}`;
    const rarity = document.createElement('strong');
    rarity.textContent = card.rarity || '—';
    meta.append(cost, rarity);
    body.append(title, meta);
    if (Array.isArray(card.civilizations)) {
      const civs = document.createElement('div');
      civs.className = 'tile-civs';
      for (const civ of normalizedCivilizations(card)) {
        const tag = document.createElement('span');
        tag.textContent = CIVILIZATIONS[civ]?.label || civ;
        civs.append(tag);
      }
      body.append(civs);
    }
    button.append(body);
    button.addEventListener('click', () => showDetails(card));
    elements.cards.append(button);
  }
}

function addDetailRow(list, label, value) {
  const wrapper = document.createElement('div');
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value === null || value === undefined || value === '' ? '—' : String(value);
  wrapper.append(term, description);
  list.append(wrapper);
}

function showDetails(card, resetHistory = true) {
  if (resetHistory) detailHistory.length = 0;
  elements.detail.replaceChildren();
  const layout = document.createElement('div');
  layout.className = 'detail-layout';
  layout.append(makeArt(card, 'detail-image'));
  const content = document.createElement('div');
  content.className = 'detail-content';
  const kicker = document.createElement('span');
  kicker.className = 'detail-kicker';
  kicker.textContent = card.id;
  const name = document.createElement('h2');
  name.id = 'detail-name';
  name.textContent = card.name;
  const specs = document.createElement('dl');
  specs.className = 'detail-specs';
  addDetailRow(specs, '文明', civilizationNames(normalizedCivilizations(card)));
  addDetailRow(specs, '紙版との違い', ({original:'デュエプレオリジナル',modified:'性能変更あり',same:'紙と同じ',unclassified:'未分類'})[card.originType] || '未分類');
  addDetailRow(specs, '種類', displayType(card.type));
  addDetailRow(specs, 'コスト', card.cost);
  addDetailRow(specs, 'パワー', card.power);
  addDetailRow(specs, '種族', Array.isArray(card.races) ? card.races.join('・') : '—');
  addDetailRow(specs, 'レアリティ', card.rarity);
  addDetailRow(specs, '収録弾', card.set);
  addDetailRow(specs, 'ゲーム', card.game === 'duel_masters_play' ? 'デュエル・マスターズ プレイス' : card.game === 'duel_masters' ? 'デュエル・マスターズ' : card.game);
  content.append(kicker, name, specs);
  if (card.text) {
    const textBlock = document.createElement('section');
    textBlock.className = 'detail-text';
    const heading = document.createElement('h3');
    heading.textContent = 'CARD TEXT';
    const paragraph = document.createElement('p');
    paragraph.textContent = card.text;
    textBlock.append(heading, paragraph);
    content.append(textBlock);
  }
  layout.append(content);
  elements.detail.append(layout);
  appendRelatedCards(card);
  if (!elements.dialog.open) elements.dialog.showModal();
  elements.dialog.scrollTop = 0;
}

elements.form.addEventListener('input', filterCards);
elements.form.addEventListener('change', filterCards);
elements.form.addEventListener('reset', () => requestAnimationFrame(filterCards));
elements.sort.addEventListener('change', filterCards);
document.querySelector('.dialog-close').addEventListener('click', () => elements.dialog.close());
elements.dialog.addEventListener('click', event => { if (event.target === elements.dialog) elements.dialog.close(); });

async function loadCatalogUpdates(baseCards) {
  const updatePaths = [
    "./data/updates/2026-11-26-1.json",
    "./data/updates/2026-11-26-2.json",
    "./data/updates/2026-11-26-3.json",
    "./data/updates/2026-11-26-4.json",
    "./data/updates/2026-11-26-5.json",
    "./data/updates/2026-11-26-6.json",
    "./data/updates/2026-11-26-7.json"
];
  const batches = await Promise.all(updatePaths.map(async path => {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`追加カードデータを読み込めませんでした (${response.status})`);
    const updates = await response.json();
    if (!Array.isArray(updates) || updates.some(card => !card || !card.id || !card.name)) {
      throw new Error('追加カードデータの形式が不正です');
    }
    return updates;
  }));
  const cardsById = new Map(baseCards.map(card => [String(card.id), card]));
  for (const card of batches.flat()) {
    const id = String(card.id);
    cardsById.set(id, { ...cardsById.get(id), ...card });
  }
  return [...cardsById.values()];
}

async function loadCards() {
  try {
    const response = await fetch('./data/cards.json');
    if (!response.ok) throw new Error(`cards.json を読み込めませんでした (${response.status})`);
    let data = await response.json();
    if (!Array.isArray(data)) throw new Error('cards.json のトップレベルは配列にしてください');
    data = await loadCatalogUpdates(data);
    warnForInvalidCards(data);
    cards = data.filter(card => card && typeof card === 'object' && !Array.isArray(card) && card.id && card.name);
    firstImplementationByName = buildFirstImplementationDates(cards);
    try {
      const relatedResponse = await fetch('./data/related-cards.json');
      if (!relatedResponse.ok) throw new Error('関連カードデータの取得失敗');
      const relations = await relatedResponse.json();
      if (!Array.isArray(relations.groups) || !Array.isArray(relations.cards)) throw new Error('関連カードデータの形式エラー');
      relatedData = relations;
    } catch (error) { relatedLoadFailed = true; console.warn(error); }
    populateOptions();
    filterCards();
  } catch (error) {
    console.error('カードデータの読み込みに失敗しました:', error);
    elements.error.hidden = false;
    elements.empty.hidden = false;
    elements.emptyTitle.textContent = 'カードデータを読み込めませんでした。';
    elements.emptyMessage.textContent = 'ローカルサーバーから開いているか、data/cards.json の内容を確認してください。';
  }
}

setupAdvancedFilters();
loadCards();
