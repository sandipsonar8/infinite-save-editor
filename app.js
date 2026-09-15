const $ = selector => document.querySelector(selector);
const state = {
  file: null,
  type: null,
  settingsOriginal: '',
  zip: null,
  gamestate: '',
  meta: '',
  playerId: null,
  resourceRange: null,
  resources: []
};

const resourcePresentation = {
  energy: ['Energy credits', 'E', '#ffd66b'],
  minerals: ['Minerals', 'M', '#ef8e72'],
  deuterium: ['Deuterium', 'D', '#79d8ff'],
  officers: ['Officers', 'O', '#c49cff'],
  food: ['Food', 'F', '#75e6a0'],
  research: ['Research', 'R', '#55c9ff'],
  influence: ['Influence', 'I', '#d8a6ff'],
  unity: ['Unity', 'U', '#ffba72'],
  alloys: ['Alloys', 'A', '#a9bdc7']
};

let toastTimer;

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function setLoading(active, message = 'Reading file…') {
  $('#loadingText').textContent = message;
  $('#loading').classList.toggle('hidden', !active);
}

function resetState() {
  state.file = null;
  state.type = null;
  state.settingsOriginal = '';
  state.zip = null;
  state.gamestate = '';
  state.meta = '';
  state.playerId = null;
  state.resourceRange = null;
  state.resources = [];
  $('#fileInput').value = '';
}

function showHome() {
  resetState();
  $('#homeView').classList.remove('hidden');
  $('#editorView').classList.add('hidden');
  $('#settingsPanel').classList.add('hidden');
  $('#savePanel').classList.add('hidden');
  $('#errorBox').classList.add('hidden');
  $('#newFileButton').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showEditorHeader(file, kind) {
  $('#homeView').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  $('#newFileButton').classList.remove('hidden');
  $('#fileName').textContent = file.name;
  $('#fileKind').textContent = kind;
  $('#errorBox').classList.add('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showFileError(file, message) {
  showEditorHeader(file, 'COULD NOT OPEN');
  $('#settingsPanel').classList.add('hidden');
  $('#savePanel').classList.add('hidden');
  const box = $('#errorBox');
  box.textContent = message;
  box.classList.remove('hidden');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function settingValue(text, key, fallback) {
  const match = text.match(new RegExp(`^\\s*${escapeRegExp(key)}=(?:"([^"]*)"|([^\\r\\n]+))\\s*$`, 'm'));
  return match ? (match[1] ?? match[2].trim()) : fallback;
}

function numberValue(text, key, fallback) {
  const parsed = Number(settingValue(text, key, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setSelectValue(select, value) {
  const normalized = String(value);
  if (![...select.options].some(option => option.value === normalized)) {
    const option = new Option(`${normalized}×`, normalized);
    select.add(option);
  }
  select.value = normalized;
}

function updateRangeOutputs() {
  $('#guiScaleOutput').value = `${Number($('#guiScaleInput').value).toFixed(2)}×`;
  $('#safeRatioOutput').value = `${Math.round(Number($('#safeRatioInput').value) * 100)}%`;
  $('#gammaOutput').value = String(Math.round(Number($('#gammaInput').value)));
}

function fillSettings(text) {
  const width = numberValue(text, 'x', 1536);
  const height = numberValue(text, 'y', 864);
  const fullScreen = settingValue(text, 'fullScreen', 'yes') === 'yes';
  const borderless = settingValue(text, 'borderless', 'no') === 'yes';
  const mode = borderless ? 'borderless' : fullScreen ? 'fullscreen' : 'windowed';
  const preset = `${width}x${height}`;

  $('#widthInput').value = width;
  $('#heightInput').value = height;
  $('#resolutionPreset').value = [...$('#resolutionPreset').options].some(option => option.value === preset) ? preset : 'custom';
  $('#displayMode').value = mode;
  $('#refreshInput').value = numberValue(text, 'refreshRate', 60);
  $('#vsyncInput').checked = settingValue(text, 'vsync', 'yes') === 'yes';
  $('#guiScaleInput').value = numberValue(text, 'gui_scale', 1);
  $('#safeRatioInput').value = numberValue(text, 'gui_safe_ratio', 1);
  $('#gammaInput').value = numberValue(text, 'gamma', 50);
  $('#qualityInput').value = String(numberValue(text, 'gfx_quality', 2));
  setSelectValue($('#aaInput'), numberValue(text, 'multi_sampling', 4));
  setSelectValue($('#anisotropyInput'), numberValue(text, 'maxanisotropy', 16));
  $('#rawSettings').value = text;
  $('#detectedResolution').textContent = `${width} × ${height}`;
  $('#detectedMode').textContent = $('#displayMode').selectedOptions[0].textContent;
  updateRangeOutputs();
}

async function openSettings(file) {
  const text = await file.text();
  if (!/graphics\s*=\s*\{/.test(text) || !/^\s*x=\d+/m.test(text) || !/^\s*y=\d+/m.test(text)) {
    throw new Error('This does not look like a compatible Star Trek: Infinite settings file.');
  }
  state.type = 'settings';
  state.settingsOriginal = text;
  fillSettings(text);
  showEditorHeader(file, 'SETTINGS FILE');
  $('#settingsPanel').classList.remove('hidden');
  $('#savePanel').classList.add('hidden');
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function firstQuoted(text, key, fallback = 'Unknown') {
  const match = text.match(new RegExp(`^${escapeRegExp(key)}="([^"]*)"`, 'm'));
  return match ? match[1] : fallback;
}

function locatePlayerResources(gamestate, meta) {
  const playerMatch = gamestate.match(/^player=\{[\s\S]*?^\s*country=(\d+)/m);
  if (!playerMatch) throw new Error('The player country could not be found in this save.');
  const playerId = playerMatch[1];

  const countryRootMatch = /^country=\{/m.exec(gamestate);
  if (!countryRootMatch) throw new Error('The country data could not be found in this save.');
  const countryRootOpen = countryRootMatch.index + countryRootMatch[0].lastIndexOf('{');
  const countryRootClose = findMatchingBrace(gamestate, countryRootOpen);
  if (countryRootClose < 0) throw new Error('The country data is incomplete.');

  const countryRootText = gamestate.slice(countryRootOpen + 1, countryRootClose);
  const countryEntryMatch = new RegExp(`^\\t${escapeRegExp(playerId)}=\\{`, 'm').exec(countryRootText);
  if (!countryEntryMatch) throw new Error(`Player country ${playerId} is missing from the country list.`);
  const countryOpen = countryRootOpen + 1 + countryEntryMatch.index + countryEntryMatch[0].lastIndexOf('{');
  const countryClose = findMatchingBrace(gamestate, countryOpen);
  if (countryClose < 0) throw new Error('The player country data is incomplete.');

  const economyMarker = 'standard_economy_module={';
  const economyStart = gamestate.indexOf(economyMarker, countryOpen);
  if (economyStart < 0 || economyStart > countryClose) throw new Error('The player resource module was not found.');
  const economyOpen = economyStart + economyMarker.length - 1;
  const economyClose = findMatchingBrace(gamestate, economyOpen);
  const resourcesMarker = 'resources={';
  const resourcesStart = gamestate.indexOf(resourcesMarker, economyOpen);
  if (resourcesStart < 0 || resourcesStart > economyClose) throw new Error('The player resource stockpile was not found.');
  const resourcesOpen = resourcesStart + resourcesMarker.length - 1;
  const resourcesClose = findMatchingBrace(gamestate, resourcesOpen);
  if (resourcesClose < 0) throw new Error('The resource stockpile is incomplete.');

  const block = gamestate.slice(resourcesOpen + 1, resourcesClose);
  const resources = [];
  const resourcePattern = /^\s*([A-Za-z_][\w]*)=(-?\d+(?:\.\d+)?)\s*$/gm;
  let match;
  while ((match = resourcePattern.exec(block))) {
    resources.push({ name: match[1], value: Number(match[2]), original: match[2] });
  }
  if (!resources.length) throw new Error('No editable resources were found for the player country.');

  const countryText = gamestate.slice(countryOpen, countryClose + 1);
  const countryNameMatch = countryText.match(/^\s*name="([^"]+)"/m);
  return {
    playerId,
    range: { start: resourcesOpen + 1, end: resourcesClose },
    resources,
    empire: countryNameMatch?.[1] || firstQuoted(meta, 'name', 'Player empire')
  };
}

function prettyResource(name) {
  return name.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function renderResources() {
  const grid = $('#resourceGrid');
  grid.replaceChildren();
  state.resources.forEach((resource, index) => {
    const [label, glyph, color] = resourcePresentation[resource.name] || [prettyResource(resource.name), resource.name.charAt(0).toUpperCase(), '#47d7ff'];
    const card = document.createElement('label');
    card.className = 'resource-card';
    card.style.setProperty('--resource-color', color);
    const labelRow = document.createElement('span');
    labelRow.className = 'resource-label';
    const glyphBox = document.createElement('span');
    glyphBox.className = 'resource-glyph';
    glyphBox.textContent = glyph;
    labelRow.append(glyphBox, document.createTextNode(label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '999999999';
    input.step = 'any';
    input.value = resource.original;
    input.dataset.resourceIndex = String(index);
    input.setAttribute('aria-label', `${label} amount`);
    const original = document.createElement('small');
    original.textContent = `Loaded: ${new Intl.NumberFormat().format(resource.value)}`;
    card.append(labelRow, input, original);
    grid.append(card);
  });
}

async function openSave(file) {
  if (typeof JSZip === 'undefined') throw new Error('The save-file reader did not load. Refresh the page and try again.');
  const zip = await JSZip.loadAsync(file);
  const gamestateEntry = zip.file('gamestate');
  const metaEntry = zip.file('meta');
  if (!gamestateEntry || !metaEntry) throw new Error('This .sav file does not contain the required gamestate and meta sections.');
  const [gamestate, meta] = await Promise.all([gamestateEntry.async('string'), metaEntry.async('string')]);
  const parsed = locatePlayerResources(gamestate, meta);

  state.type = 'save';
  state.zip = zip;
  state.gamestate = gamestate;
  state.meta = meta;
  state.playerId = parsed.playerId;
  state.resourceRange = parsed.range;
  state.resources = parsed.resources;
  renderResources();

  $('#empireName').textContent = parsed.empire;
  $('#gameDate').textContent = firstQuoted(meta, 'date', firstQuoted(gamestate, 'date', 'Unknown'));
  $('#saveVersion').textContent = firstQuoted(meta, 'version', firstQuoted(gamestate, 'version', 'Unknown'));
  $('#playerId').textContent = parsed.playerId;
  showEditorHeader(file, 'SAVE GAME');
  $('#savePanel').classList.remove('hidden');
  $('#settingsPanel').classList.add('hidden');
}

async function acceptFile(file) {
  if (!file) return;
  if (!/\.(txt|sav)$/i.test(file.name)) {
    showToast('Choose settings.txt or a .sav file.');
    return;
  }
  if (file.size > 250 * 1024 * 1024) {
    showFileError(file, 'This file is larger than 250 MB and cannot be safely handled in the browser.');
    return;
  }
  resetState();
  state.file = file;
  setLoading(true, file.name.toLowerCase().endsWith('.sav') ? 'Opening save game…' : 'Reading settings…');
  try {
    if (file.name.toLowerCase().endsWith('.sav')) await openSave(file);
    else await openSettings(file);
  } catch (error) {
    console.error(error);
    showFileError(file, error instanceof Error ? error.message : 'This file could not be opened.');
  } finally {
    setLoading(false);
  }
}

function replaceSetting(text, key, value) {
  const pattern = new RegExp(`(^\\s*${escapeRegExp(key)}=)("[^"]*"|[^\\r\\n]+)`, 'm');
  if (!pattern.test(text)) throw new Error(`The ${key} setting is missing from this file.`);
  return text.replace(pattern, (_, prefix) => `${prefix}${value}`);
}

function collectSettings() {
  const width = Math.round(Number($('#widthInput').value));
  const height = Math.round(Number($('#heightInput').value));
  const refresh = Math.round(Number($('#refreshInput').value));
  if (!Number.isFinite(width) || width < 640 || width > 7680) throw new Error('Width must be between 640 and 7680.');
  if (!Number.isFinite(height) || height < 480 || height > 4320) throw new Error('Height must be between 480 and 4320.');
  if (!Number.isFinite(refresh) || refresh < 30 || refresh > 360) throw new Error('Refresh rate must be between 30 and 360.');

  const mode = $('#displayMode').value;
  const updates = {
    x: width,
    y: height,
    gui_scale: Number($('#guiScaleInput').value).toFixed(6),
    gui_safe_ratio: Number($('#safeRatioInput').value).toFixed(6),
    refreshRate: refresh,
    fullScreen: mode === 'fullscreen' ? 'yes' : 'no',
    borderless: mode === 'borderless' ? 'yes' : 'no',
    multi_sampling: Math.round(Number($('#aaInput').value)),
    maxanisotropy: Math.round(Number($('#anisotropyInput').value)),
    gamma: Number($('#gammaInput').value).toFixed(6),
    vsync: $('#vsyncInput').checked ? 'yes' : 'no',
    gfx_quality: Math.round(Number($('#qualityInput').value))
  };
  return Object.entries(updates).reduce((text, [key, value]) => replaceSetting(text, key, value), $('#rawSettings').value);
}

function editedName(name, extension) {
  const suffix = new RegExp(`${escapeRegExp(extension)}$`, 'i');
  return suffix.test(name) ? name.replace(suffix, `.edited${extension}`) : `${name}.edited${extension}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function updateResourceBlock(gamestate, range, resources, values) {
  let block = gamestate.slice(range.start, range.end);
  resources.forEach((resource, index) => {
    const value = Number(values[index]);
    if (!Number.isFinite(value) || value < 0 || value > 999999999) throw new Error(`${prettyResource(resource.name)} must be between 0 and 999,999,999.`);
    const pattern = new RegExp(`(^\\s*${escapeRegExp(resource.name)}=)(-?\\d+(?:\\.\\d+)?)(\\s*$)`, 'm');
    if (!pattern.test(block)) throw new Error(`${prettyResource(resource.name)} could not be updated.`);
    block = block.replace(pattern, (_, prefix, __, ending) => `${prefix}${values[index]}${ending}`);
  });
  return gamestate.slice(0, range.start) + block + gamestate.slice(range.end);
}

async function downloadEditedSave() {
  const inputs = [...$('#resourceGrid').querySelectorAll('input[data-resource-index]')];
  const values = inputs.map(input => input.value);
  const updated = updateResourceBlock(state.gamestate, state.resourceRange, state.resources, values);
  state.zip.file('gamestate', updated);
  setLoading(true, 'Building edited save…');
  try {
    const blob = await state.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 }, platform: 'DOS' });
    downloadBlob(blob, editedName(state.file.name, '.sav'));
    showToast('Edited save downloaded.');
  } finally {
    setLoading(false);
  }
}

$('#chooseFile').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', () => acceptFile($('#fileInput').files[0]));
$('#homeButton').addEventListener('click', showHome);
$('#newFileButton').addEventListener('click', showHome);
$('#dropZone').addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('#fileInput').click();
  }
});
['dragenter', 'dragover'].forEach(type => $('#dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('#dropZone').classList.add('dragging');
}));
['dragleave', 'drop'].forEach(type => $('#dropZone').addEventListener(type, event => {
  event.preventDefault();
  $('#dropZone').classList.remove('dragging');
}));
$('#dropZone').addEventListener('drop', event => acceptFile(event.dataTransfer.files[0]));

$('#resolutionPreset').addEventListener('change', event => {
  if (event.target.value === 'custom') return;
  const [width, height] = event.target.value.split('x');
  $('#widthInput').value = width;
  $('#heightInput').value = height;
});
['widthInput', 'heightInput'].forEach(id => $(`#${id}`).addEventListener('input', () => {
  const value = `${$('#widthInput').value}x${$('#heightInput').value}`;
  $('#resolutionPreset').value = [...$('#resolutionPreset').options].some(option => option.value === value) ? value : 'custom';
}));
['guiScaleInput', 'safeRatioInput', 'gammaInput'].forEach(id => $(`#${id}`).addEventListener('input', updateRangeOutputs));
$('#useScreenButton').addEventListener('click', () => {
  const pixelRatio = window.devicePixelRatio || 1;
  const screenWidth = Math.round(window.screen.width * pixelRatio);
  const screenHeight = Math.round(window.screen.height * pixelRatio);
  $('#widthInput').value = screenWidth;
  $('#heightInput').value = screenHeight;
  $('#displayMode').value = 'borderless';
  const preset = `${screenWidth}x${screenHeight}`;
  $('#resolutionPreset').value = [...$('#resolutionPreset').options].some(option => option.value === preset) ? preset : 'custom';
  showToast(`Set to ${screenWidth} × ${screenHeight} borderless.`);
});
$('#resetSettings').addEventListener('click', () => {
  fillSettings(state.settingsOriginal);
  showToast('Settings restored to the loaded file.');
});
$('#settingsPanel').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const text = collectSettings();
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), editedName(state.file.name, '.txt'));
    showToast('Edited settings downloaded.');
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Could not create the edited file.');
  }
});

$('#maxAllButton').addEventListener('click', () => {
  const value = Number($('#maxValue').value);
  if (!Number.isFinite(value) || value < 0 || value > 999999999) {
    showToast('Max value must be between 0 and 999,999,999.');
    return;
  }
  $('#resourceGrid').querySelectorAll('input[data-resource-index]').forEach(input => { input.value = String(value); });
  showToast('All resources updated.');
});
$('#resetResources').addEventListener('click', () => {
  state.resources.forEach((resource, index) => {
    const input = $(`#resourceGrid input[data-resource-index="${index}"]`);
    if (input) input.value = resource.original;
  });
  showToast('Resources restored to the loaded save.');
});
$('#savePanel').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    await downloadEditedSave();
  } catch (error) {
    setLoading(false);
    showToast(error instanceof Error ? error.message : 'Could not create the edited save.');
  }
});

function registerAgentTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    {
      name: 'stage_display_settings',
      title: 'Stage display settings',
      description: 'Stage screen resolution and display mode changes in an opened settings.txt file. This does not download or overwrite the file.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'integer', minimum: 640, maximum: 7680 },
          height: { type: 'integer', minimum: 480, maximum: 4320 },
          mode: { type: 'string', enum: ['borderless', 'fullscreen', 'windowed'] },
          refreshRate: { type: 'integer', minimum: 30, maximum: 360 },
          vsync: { type: 'boolean' }
        },
        required: ['width', 'height', 'mode'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (state.type !== 'settings') throw new Error('Open a settings.txt file first.');
        if (!Number.isInteger(input.width) || input.width < 640 || input.width > 7680) throw new Error('Width is outside the supported range.');
        if (!Number.isInteger(input.height) || input.height < 480 || input.height > 4320) throw new Error('Height is outside the supported range.');
        if (!['borderless', 'fullscreen', 'windowed'].includes(input.mode)) throw new Error('Display mode is invalid.');
        $('#widthInput').value = String(input.width);
        $('#heightInput').value = String(input.height);
        $('#displayMode').value = input.mode;
        if (input.refreshRate !== undefined) {
          if (!Number.isInteger(input.refreshRate) || input.refreshRate < 30 || input.refreshRate > 360) throw new Error('Refresh rate is outside the supported range.');
          $('#refreshInput').value = String(input.refreshRate);
        }
        if (input.vsync !== undefined) $('#vsyncInput').checked = Boolean(input.vsync);
        const preset = `${input.width}x${input.height}`;
        $('#resolutionPreset').value = [...$('#resolutionPreset').options].some(option => option.value === preset) ? preset : 'custom';
        showToast('Display changes staged.');
        return { staged: true, width: input.width, height: input.height, mode: input.mode };
      }
    },
    {
      name: 'stage_all_resource_values',
      title: 'Stage all resource values',
      description: 'Set every visible player resource to one value in an opened .sav file. This does not download or overwrite the save.',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'number', minimum: 0, maximum: 999999999 } },
        required: ['value'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (state.type !== 'save') throw new Error('Open a .sav file first.');
        if (!Number.isFinite(input.value) || input.value < 0 || input.value > 999999999) throw new Error('Resource value is outside the supported range.');
        const inputs = [...$('#resourceGrid').querySelectorAll('input[data-resource-index]')];
        inputs.forEach(field => { field.value = String(input.value); });
        $('#maxValue').value = String(input.value);
        showToast('All resources updated.');
        return { staged: true, resourcesUpdated: inputs.length, value: input.value };
      }
    }
  ];
  tools.forEach(tool => {
    try {
      void Promise.resolve(context.registerTool(tool)).catch(error => console.warn('Agent tool registration failed.', error));
    } catch (error) {
      console.warn('Agent tool registration failed.', error);
    }
  });
}

registerAgentTools();
