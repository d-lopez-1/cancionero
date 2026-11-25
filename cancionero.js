/* ═══════════════════════════════════════════════════════════════════════
   CANCIONERO PASTORAL — funcionamiento
   Versión 6 · 24/11/2026 (funciona sin conexión)
   Si cambias este archivo, sube el número de ?v= en index.html

   ÍNDICE
    1. Configuración (dirección del Sheet, secciones)
    2. Estado y preferencias guardadas
    3. Acordes: reconocerlos
    4. Notación Do-Re-Mi (inglés → español, al mostrar)
    5. Cambio de tono
    6. Líneas especiales: "Intro: C F G" y paréntesis
    7. Carga de canciones desde el Google Sheet
    8. Lista de canciones y filtro por sección
    9. Visor de la canción
    9b. Canción anterior / siguiente (⏪ ⏩)
   10. Botones: Do-Re-Mi, solo letra, modo noche, tamaño de letra
   11. Enlace directo a una canción y compartir
   12. Botón flotante 🔍
   12b. Imprimir / guardar en PDF (🖨️)
   12c. Mis listas (📋)
   12d. Compartir una lista con un enlace
   12e. Sin conexión (sw.js)
   13. Inicio
   ═══════════════════════════════════════════════════════════════════════ */


// ── 1. CONFIGURACIÓN ─────────────────────────────────────────────────────────

// Hoja "Songs" del Google Sheet, publicada como CSV
const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSrDH4DpWxwKH0tlNvUvtPclKxPLOjpzat8T_gjtNR6gS2talVoCf98s9G_bdP6YqlmjwLFCTkKM98Y/pub?gid=450216955&single=true&output=csv';

// Secciones, en el orden en que salen. Deben coincidir EXACTAMENTE con la columna D del Sheet
const THEMES = [
  "General", "Eucaristía", "María",
  "Adviento-Navidad", "Cuaresma-Pascua", "SaFa", "Aclamaciones",
  "Hakuna",
];


// ── 2. ESTADO Y PREFERENCIAS GUARDADAS ───────────────────────────────────────

const parser    = new ChordSheetJS.ChordsOverWordsParser();
const formatter = new ChordSheetJS.ChordsOverWordsFormatter();

let SONGS          = [];     // canciones cargadas: { code, title, key, section, chordpro }
let currentIndex   = null;   // canción abierta (posición en SONGS) o null
let transposeSteps = 0;      // semitonos de cambio de tono de la canción abierta (-11 … +11)
let song           = null;   // canción abierta, ya preparada por la librería
let activeTheme    = null;   // sección elegida en el filtro (null = Todas)

// Preferencias guardadas en el navegador (se recuerdan al recargar)
function loadPref(name, fallback) {
  try { const v = localStorage.getItem(name); return v === null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function savePref(name, value) {
  try { localStorage.setItem(name, JSON.stringify(value)); } catch (e) {}
}

let useSpanishNotation = loadPref('cancionero.spanish', false) === true;
let lyricsOnly         = loadPref('cancionero.lyricsOnly', false) === true;
const DEFAULT_FONT     = window.innerWidth <= 600 ? 13 : 15;   // en móvil, algo más pequeña
let fontSize           = Math.max(10, Math.min(24, Number(loadPref('cancionero.fontSize', DEFAULT_FONT)) || DEFAULT_FONT));


// ── 3. ACORDES: RECONOCERLOS ─────────────────────────────────────────────────

// Acorde en inglés: raíz (A-G), alteración (# o b), sufijo (m, 7, maj7, sus4...) y bajo opcional (/E)
const CHORD_RE = /^([A-G])([#b]?)([^\/\s]*)(?:\/([A-G])([#b]?))?$/;

/** ¿Es este trozo de texto un acorde en notación inglesa? (C, Am7, F#m, Bb, C/E, Gsus4...) */
function isChordToken(tok) {
  const m = tok.match(CHORD_RE);
  return !!m && /^(m|maj|min|sus|dim|aug|add|M|\+|º|°|-|\d|\(|\)|b|#)*$/.test(m[3]);
}

/** Una línea es de acordes si TODAS sus palabras son acordes en inglés. */
function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  return toks.length > 0 && toks.every(isChordToken);
}


// ── 4. NOTACIÓN DO-RE-MI (inglés → español, al mostrar) ──────────────────────

const NOTAS_ES = { C:'Do', D:'Re', E:'Mi', F:'Fa', G:'Sol', A:'La', B:'Si' };

/** Un acorde inglés → español. Am → lam, Bb → Sib, C/E → Do/Mi, Cmaj7 → Domaj7 */
function chordToSpanish(chord) {
  const m = chord.match(CHORD_RE);
  if (!m) return chord;
  const [, root, acc, suffix, bassRoot, bassAcc] = m;
  let r = NOTAS_ES[root] + acc;
  if (/^m(?!aj)/.test(suffix)) r = r.toLowerCase();   // menor: raíz en minúscula
  return r + suffix + (bassRoot ? '/' + NOTAS_ES[bassRoot] + bassAcc : '');
}

/**
 * Convierte una línea de acordes manteniendo cada acorde en su columna original.
 * Si el acorde anterior (ya convertido) no deja sitio, se separa con un solo espacio.
 */
function convertChordLine(line) {
  const re = /\S+/g;
  let out = '', m;
  while ((m = re.exec(line)) !== null) {
    const col  = m.index;
    const conv = chordToSpanish(m[0]);
    if (out.length === 0 && col === 0) out = conv;
    else if (out.length >= col)        out += ' ' + conv;
    else                               out = out.padEnd(col, ' ') + conv;
  }
  return out;
}


// ── 5. CAMBIO DE TONO ────────────────────────────────────────────────────────
// Los acordes de las líneas normales los cambia la librería (song.transpose).
// Estas funciones sirven para la tonalidad de arriba y para las líneas especiales (apartado 6).

// Transpone la tonalidad conservando el sufijo (Am → A#m, F#m → Gm, C → D). Usa siempre sostenidos.
function transposeChord(key, steps) {
  const CHROMATIC  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ENHARMONIC = { Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#' };
  const m = String(key).match(/^([A-G][#b]?)(.*)$/);
  if (!m) return key;
  const root = ENHARMONIC[m[1]] || m[1];
  const idx  = CHROMATIC.indexOf(root);
  if (idx === -1) return key;
  return CHROMATIC[((idx + steps) % 12 + 12) % 12] + m[2];
}

// Un acorde completo cambiado de tono, también el bajo (C/E +2 → D/F#)
function transposeFullChord(chord, steps) {
  const m = chord.match(CHORD_RE);
  if (!m || !steps) return chord;
  const [, root, acc, suffix, bassRoot, bassAcc] = m;
  return transposeChord(root + acc, steps) + suffix +
    (bassRoot ? '/' + transposeChord(bassRoot + bassAcc, steps) : '');
}

// Semitonos → texto en tonos: 1 → "+0,5 tono", 2 → "+1 tono", 3 → "+1,5 tonos", -4 → "-2 tonos"
function formatTones(semitones) {
  if (!semitones) return '';
  const abs  = Math.abs(semitones);
  const sign = semitones > 0 ? '+' : '-';
  return `${sign}${String(abs / 2).replace('.', ',')} ${abs > 2 ? 'tonos' : 'tono'}`;
}


// ── 6. LÍNEAS ESPECIALES: "Intro: C F G" Y PARÉNTESIS ────────────────────────
// La librería no las reconoce bien: las "Intro:" del principio las hace desaparecer o las trata
// como letra, y cambia "(III)" por "(#IV)". Por eso la web las aparta antes de dárselas a la
// librería (dejando una marca en su sitio) y luego las pinta ella misma.
// Los paréntesis son indicaciones (repeticiones, otras versiones): los ACORDES de dentro cambian
// de tono y de notación; lo demás ("x2", "2º", "bis", "(III)", "vez") se queda tal cual.

// Etiquetas que pueden ir delante de una línea de acordes ("Intro: C F G")
// (las palabras largas primero, y sin letras pegadas detrás: "Introducción" no es "Intro" + "ducción")
const INTRO_LABEL_RE = /^(\s*(?:introducci[oó]n|instrumental|interludio|intro|int|m[uú]sica|mus|final|outro)(?![a-záéíóúüñ])\s*:?\s*)/i;

const PAREN_GROUP_RE = /\([^()]*\)/g;
// Lo que puede ir dentro de un paréntesis en una línea sin acordes fuera: "(x2)", "(bis)", "(III)", "(2º)"...
const ANNOTATION_RE  = /^(x\s*\d+|\d+\s*x|bis|[IVX]+\.?|\d+[ºª]?\.?)$/i;

function parenParts(line) {
  const inside  = (line.match(PAREN_GROUP_RE) || []).join(' ').replace(/[()]/g, ' ');
  const outside = line.replace(PAREN_GROUP_RE, ' ');
  return {
    outTokens: outside.trim().split(/\s+/).filter(Boolean),
    inTokens:  inside.trim().split(/\s+/).filter(Boolean),
    balanced:  !/[()]/.test(outside),
  };
}

// ¿Línea de acordes con paréntesis? Fuera del paréntesis, solo acordes.
// Si fuera no hay nada ("(A)", "(x2)", "(III)"), dentro solo acordes o indicaciones.
function isParenChordLine(line) {
  if (!line.includes('(')) return false;
  const { outTokens, inTokens, balanced } = parenParts(line);
  if (!balanced || !outTokens.every(isChordToken)) return false;
  if (outTokens.length) return true;
  return inTokens.length > 0 && inTokens.every(t => isChordToken(t) || ANNOTATION_RE.test(t));
}

// ¿Lleva algún acorde (dentro o fuera del paréntesis)? → se pinta en verde y se quita en "solo letra"
function hasChords(line) {
  const { outTokens, inTokens } = parenParts(line);
  return outTokens.some(isChordToken) || inTokens.some(isChordToken);
}

// Etiqueta "Intro:" (o similar) seguida de algo, o '' si no la hay
function introLabel(line) {
  const m = line.match(INTRO_LABEL_RE);
  return m && /\S/.test(line.slice(m[1].length)) ? m[1] : '';
}

// Líneas que pinta la web por su cuenta: "Intro: C F G" y líneas de acordes con paréntesis
function isSpecialLine(line) {
  const label = introLabel(line);
  const rest  = line.slice(label.length);
  return (label && isChordLine(rest)) || isParenChordLine(rest);
}

// Para "solo letra": cualquier línea de acordes (normal, con "Intro:" o con paréntesis)
function isChordishLine(line) {
  if (isChordLine(line)) return true;
  return isSpecialLine(line) && hasChords(line.slice(introLabel(line).length));
}

let currentIntros = [];                       // líneas especiales apartadas de la canción abierta
const introMark = i => `⟦intro${i}⟧`;         // marca que ocupa su sitio mientras tanto

// Prepara la canción: aparta las líneas especiales, deja la marca y se la da a la librería
function parseSong(text) {
  currentIntros = [];
  const marked = text.split('\n').map(line => {
    if (!isSpecialLine(line)) return line;
    currentIntros.push(line);
    return introMark(currentIntros.length - 1);
  }).join('\n');
  return parser.parse(marked);
}

// Pinta una línea especial: etiqueta en color normal, el resto en verde si lleva acordes.
// Los acordes cambian de tono y de notación, también los de dentro del paréntesis ("C (D)" +1 tono
// → "D (E)"). Lo que no es acorde se queda tal cual. Cada trozo se queda en su columna.
function renderSpecialLine(line) {
  const label = introLabel(line);
  const rest  = line.slice(label.length);
  const re = /\S+/g;
  let out = '', m;
  while ((m = re.exec(rest)) !== null) {
    const col = m.index;
    // separa los paréntesis pegados: "(D)" → "(" + "D" + ")", "(2º" → "(" + "2º"
    const [, open, core, close] = m[0].match(/^(\(*)(.*?)(\)*)$/);
    let chord = core;
    if (isChordToken(core)) {
      chord = transposeFullChord(core, transposeSteps);
      if (useSpanishNotation) chord = chordToSpanish(chord);
    }
    const tok = open + chord + close;
    if (out.length === 0 && col === 0) out = tok;
    else if (out.length >= col)        out += ' ' + tok;
    else                               out = out.padEnd(col, ' ') + tok;
  }
  return label + (hasChords(rest) ? `<span class="chord-line">${out}</span>` : out);
}


// ── 7. CARGA DE CANCIONES DESDE EL GOOGLE SHEET ──────────────────────────────
// Columnas (por posición, la fila 1 de cabeceras se ignora):
// A = Code · B = Título · C = Key · D = Sección · E = Letra y acordes

// Lee el CSV respetando comillas y saltos de línea dentro de las celdas
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row); }
  return rows;
}

// Por si alguien escribe una canción en el Sheet con acordes en español (Do, SOL, lam...):
// al cargar se pasan a inglés SOLO sus líneas de acordes; la letra no se toca.

const SPANISH_TO_ENGLISH = {
  'Do':'C','Re':'D','Mi':'E','Fa':'F','Sol':'G','La':'A','Si':'B',
  'Do#':'C#','Re#':'D#','Mi#':'E#','Fa#':'F#','Sol#':'G#','La#':'A#','Si#':'B#',
  'Dob':'Cb','Reb':'Db','Mib':'Eb','Fab':'Fb','Solb':'Gb','Lab':'Ab','Sib':'Bb'
};

// ¿Hay notas en español? Tanto "Do, Sol" como "DO, SOL"
function detectSpanishNotation(text) {
  return /\b(?:Do|Re|Mi|Fa|Sol|La|Si|DO|RE|MI|FA|SOL|LA|SI)[#Bb]?(?:maj|min|dim|aug|sus|add|MAJ|MIN|DIM|AUG|SUS|ADD|m|M)?\d*\b/
    .test(text);
}

// MAYÚSCULAS → "Do Sol": DO → Do · SOL → Sol · LAM → Lam · RE7 → Re7 · DOM7 → Dom7
function normalizeSpanishCase(text) {
  return text.replace(
    /\b(DO|RE|MI|FA|SOL|LA|SI)([#B]?)((?:MAJ|MIN|DIM|AUG|SUS|ADD|M)?\d*)\b/g,
    (_, note, acc, mod) =>
      note[0] + note.slice(1).toLowerCase() +   // DO→Do, SOL→Sol …
      (acc === 'B' ? 'b' : acc) +                // B bemol → b minúscula
      mod.toLowerCase()                          // MAJ→maj, M→m …
  );
}

// ¿La línea son solo acordes (ingleses o españoles ya normalizados)? Evita tomar por acordes
// palabras sueltas de la letra como "LA", "MI" o "RE".
function isChordOnlyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const withoutChords = trimmed
    .replace(/\b[A-G][#b]?(?:maj|min|dim|aug|sus|add|m)?\d*\b/g, '')
    .replace(/\b(?:Do|Re|Mi|Fa|Sol|La|Si)[#b]?(?:maj|min|dim|aug|sus|add|m)?\d*\b/g, '');
  return withoutChords.trim() === '';
}

// Una línea de acordes en español → inglés, ajustando los espacios para no descolocar los acordes
function spanishChordsToEnglish(line) {
  if (!line) return line;
  return line.replace(/(Do|Re|Mi|Fa|Sol|La|Si)([#b]?)(?:m|maj|min|dim|aug|sus|add)?[0-9]*(\s*)/g,
    (match, note, accidental, spaces) => {
      const fullMatch = match.match(/^(Do|Re|Mi|Fa|Sol|La|Si)([#b]?)((?:m|maj|min|dim|aug|sus|add)?[0-9]*)/);
      if (!fullMatch) return match;
      const [, noteName, acc, modifiers] = fullMatch;
      const fullNote  = noteName + acc;
      const converted = SPANISH_TO_ENGLISH[fullNote];
      if (!converted) return match;
      const lengthDiff = (converted + modifiers).length - (fullNote + modifiers).length;
      return converted + modifiers + ' '.repeat(Math.max(0, spaces.length - lengthDiff));
    });
}

function normalizeKey(key) {
  return spanishChordsToEnglish(key + ' ').trim();
}

function showListMessage(text, isError) {
  document.getElementById('song-list').innerHTML =
    `<li class="list-message${isError ? ' error' : ''}">${text}</li>`;
}

async function loadFromSheet() {
  showListMessage('Cargando canciones...');
  try {
    const resp = await fetch(SHEET_CSV_URL);
    const text = await resp.text();
    sheetCopyInfo(resp, text);   // sin conexión: aviso con la fecha de la copia (apartado 12e)
    const rows = parseCSV(text);

    // Cada columna se busca por el nombre de su cabecera (fila 1), así se pueden
    // reordenar las columnas del Sheet. Si no se encuentra, se usa la posición antigua.
    const head = (rows[0] || []).map(h => (h || '').trim().toLowerCase());
    const col = (name, pos) => { const i = head.indexOf(name.toLowerCase()); return i >= 0 ? i : pos; };
    const C = { code: col('Code', 0), title: col('Título', 1), key: col('Key', 2),
                section: col('Sección', 3), chords: col('Letra y acordes', 4) };

    SONGS = rows.slice(1)
      .filter(r => r[C.code] && r[C.code].trim())          // filas sin code se ignoran
      .map(r => {
        // Se quitan líneas vacías al principio y espacios al final, pero NO la sangría
        // de la primera línea (si no, el primer acorde se descoloca)
        const rawChords = r[C.chords] ? r[C.chords].replace(/^\s*\n/, '').trimEnd() : '';
        const rawKey    = r[C.key] ? r[C.key].trim() : '';

        // Canción con acordes en español: se pasan a inglés solo las líneas de acordes
        const isSpanish = detectSpanishNotation(rawChords) || detectSpanishNotation(rawKey);
        const chordpro = isSpanish
          ? rawChords.split('\n').map(line => {
              const norm = normalizeSpanishCase(line);
              return isChordOnlyLine(norm) ? spanishChordsToEnglish(norm) : line;
            }).join('\n')
          : rawChords;
        const key = isSpanish ? normalizeKey(normalizeSpanishCase(rawKey)) : rawKey;

        return { code: r[C.code].trim(), title: r[C.title].trim(), key, section: r[C.section].trim(), chordpro };
      });

    renderThemeFilter();
    renderList();
    openFromLink();   // si se ha abierto un enlace a una canción (#205/+2), se abre
  } catch (e) {
    showListMessage('Error al cargar. Comprueba que el Google Sheet está publicado como CSV.', true);
    console.error(e);
  }
}


// ── 8. LISTA DE CANCIONES Y FILTRO POR SECCIÓN ───────────────────────────────

function renderThemeFilter() {
  const div     = document.getElementById('theme-filter');
  const inUse   = new Set(SONGS.map(s => s.section));
  const visible = THEMES.filter(t => inUse.has(t));
  div.innerHTML = ['Todas', ...visible].map(t => {
    const isActive = (t === 'Todas' && activeTheme === null) || t === activeTheme;
    const onclick  = t === 'Todas' ? 'setTheme(null)' : `setTheme('${t}')`;
    return `<button onclick="${onclick}" class="${isActive ? 'active' : ''}">${t}</button>`;
  }).join('');
}

function setTheme(theme) {
  activeTheme = theme;
  renderThemeFilter();
  renderList();
}

// Texto en minúsculas y sin tildes ni diéresis (María → maria, pingüino → pinguino),
// para que el buscador encuentre la canción se escriba con tilde o sin ella
function sinTildes(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Canciones de la lista, en el orden en que salen (por secciones, en el orden de THEMES),
// filtradas por la sección elegida y por el buscador (busca en título, código y
// letra/acordes, sin tener en cuenta las tildes). Con withFilters = false, todas.
function listedSongs(withFilters = true) {
  const q = withFilters ? sinTildes(document.getElementById('search').value.trim()) : '';
  const theme = withFilters ? activeTheme : null;
  const filtered = SONGS
    .map((s, i) => ({ ...s, index: i }))
    .filter(s => {
      if (theme && s.section !== theme) return false;
      if (!q) return true;
      return sinTildes(s.title).includes(q)
          || sinTildes(s.code).includes(q)
          || sinTildes(s.chordpro).includes(q);
    });
  return THEMES.flatMap(t => filtered.filter(s => s.section === t));
}

// Lista agrupada por sección
function renderList() {
  const filtered = listedSongs();
  updateNavButtons();   // ⏪ ⏩ siguen esta lista
  renderMyList();       // Mi lista (apartado 12c): marca la canción abierta

  if (!filtered.length) {
    showListMessage('No se encontraron canciones.');
    return;
  }

  const groups = {};
  for (const s of filtered) {
    if (!groups[s.section]) groups[s.section] = [];
    groups[s.section].push(s);
  }
  const orderedThemes = THEMES.filter(t => groups[t]);

  let html = '';
  for (const theme of orderedThemes) {
    if (orderedThemes.length > 1)
      html += `<div class="theme-group-title">${theme}</div>`;
    for (const s of groups[theme]) {
      html += `<li class="${s.index === currentIndex ? 'active' : ''}" onclick="loadSong(${s.index})">
        <span class="song-code">${s.code}</span>${s.title}${listAddButton(s.index)}
      </li>`;
    }
  }
  document.getElementById('song-list').innerHTML = html;
}


// ── 9. VISOR DE LA CANCIÓN ───────────────────────────────────────────────────

// steps: tono con el que se abre (por un enlace). updateLink: false cuando viene del botón "atrás"/"adelante"
// fromMyList: true cuando se abre desde Mi lista (entonces ⏪ ⏩ siguen Mi lista, apartado 12c)
function loadSong(index, steps = 0, updateLink = true, fromMyList = false) {
  const wasOpen  = currentIndex !== null;
  currentIndex   = index;
  openedFromMyList = fromMyList;
  transposeSteps = (steps % 12) || 0;
  song = parseSong(SONGS[index].chordpro);
  if (transposeSteps !== 0) song = song.transpose(transposeSteps);
  renderSong();
  renderList();
  document.getElementById('song-viewer').style.display = 'block';
  document.getElementById('song-viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Desde la lista se añade un paso al historial (así "atrás" vuelve a la lista);
  // de una canción a otra se sustituye (así "atrás" no va recorriendo canciones)
  if (updateLink) updateLinkInAddressBar(!wasOpen);
}

// Cierra la canción y deja solo la lista (lo que hace el botón "atrás")
function closeSong() {
  currentIndex   = null;
  openedFromMyList = false;
  transposeSteps = 0;
  document.getElementById('song-viewer').style.display = 'none';
  renderList();
  window.scrollTo(0, 0);
}

function renderSong() {
  const s = SONGS[currentIndex];
  document.getElementById('viewer-title').textContent = `${s.code} · ${s.title}`;

  // Tonalidad (de la columna C del Sheet), cambiada de tono y en Do-Re-Mi si toca
  let currentKey = transposeSteps === 0 ? s.key : transposeChord(s.key, transposeSteps);
  if (useSpanishNotation) currentKey = chordToSpanish(currentKey);

  const toneText = formatTones(transposeSteps);
  document.getElementById('viewer-meta').textContent =
    `${s.section}  ·  Tonalidad: ${currentKey}` +
    (toneText ? `  (${toneText})` : '');
  document.getElementById('tone-label').textContent = toneText;
  updateViewerListButton();

  let coloredLines;
  if (lyricsOnly) {
    // Solo letra: se parte del texto original del Sheet (sin los huecos que mete la librería)
    // y se quitan las líneas de acordes; no quedan dos líneas vacías seguidas
    coloredLines = s.chordpro.split('\n')
      .filter(l => !l.trim().startsWith('{') && !isChordishLine(l))
      .filter((l, i, arr) => l.trim() || (i > 0 && arr[i - 1].trim()));
    while (coloredLines.length && !coloredLines[0].trim()) coloredLines.shift();
  } else {
    // Con acordes: el texto lo prepara la librería (siempre en inglés); las líneas de
    // "title:", "key:" y "capo:" que añade se quitan
    const bodyLines = formatter.format(song).split('\n').filter(l =>
      !l.startsWith('title: ') && !l.startsWith('key: ') && !l.startsWith('capo: ')
    );
    // En un solo paso: líneas especiales (apartado 6), y líneas de acordes en verde y en Do-Re-Mi si toca
    coloredLines = bodyLines.map(line => {
      const special = line.trim().match(/^⟦intro(\d+)⟧$/);
      if (special) return renderSpecialLine(currentIntros[+special[1]]);
      return isChordLine(line)
        ? `<span class="chord-line">${useSpanishNotation ? convertChordLine(line) : line}</span>`
        : line;
    });
  }

  const preElement = document.getElementById('song');
  preElement.innerHTML = '<pre>' + coloredLines.join('\n') + '</pre>';
  preElement.querySelector('pre').style.fontSize = fontSize + 'px';
}

// ── 9b. CANCIÓN ANTERIOR / SIGUIENTE (⏪ ⏩) ─────────────────────────────────
// Siguen el orden de la lista que se está viendo (con la sección y el buscador aplicados).
// Si la canción abierta no está en esa lista (p. ej. se ha cambiado la búsqueda después),
// siguen el orden de la lista completa. Al llegar al principio o al final, el botón se apaga.
// Cada canción se abre en su tono original. Para las listas propias (mejora 11) bastará
// con que navList() devuelva la lista elegida.

// Posiciones (en SONGS) de las canciones por las que se pasa, en orden
function navList() {
  if (navigatingMyList()) return myListIndexes();   // abierta desde Mi lista: se pasa por Mi lista
  const list = listedSongs().map(s => s.index);
  return list.includes(currentIndex) ? list : listedSongs(false).map(s => s.index);
}

// La canción de antes (delta = -1) o la de después (+1), o undefined si no hay
function neighbourSong(delta) {
  if (currentIndex === null) return undefined;
  const list = navList();
  const pos  = list.indexOf(currentIndex);
  return pos === -1 ? undefined : list[pos + delta];
}

function goToSong(delta) {
  const index = neighbourSong(delta);
  if (index === undefined) return;
  if (navigatingMyList()) openMyListSong(myListIndexes().indexOf(index));   // en su tono guardado
  else loadSong(index);
}

// Arriba, junto al título: solo ⏪ ⏩. Abajo, al final de la canción: también el código y el título
function updateNavButtons() {
  for (const [delta, id] of [[-1, 'prev'], [1, 'next']]) {
    const index = neighbourSong(delta);
    const s     = index !== undefined ? SONGS[index] : null;
    const name  = s ? `${s.code} · ${s.title}` : '';
    const hint  = s ? (delta < 0 ? 'Anterior: ' : 'Siguiente: ') + name
                    : (delta < 0 ? 'Es la primera de la lista' : 'Es la última de la lista');
    for (const btn of [document.getElementById(id + '-btn'), document.getElementById(id + '-btn-bottom')]) {
      btn.disabled = !s;
      btn.title = hint;
      btn.setAttribute('aria-label', hint);
    }
    // abajo: el emoji siempre se ve; si el título no cabe, se corta con "…"
    const bottom = document.getElementById(id + '-btn-bottom');
    const label  = document.createElement('span');
    label.className   = 'song-nav-name';
    label.textContent = name;
    bottom.replaceChildren(...(delta < 0 ? ['⏪', label] : [label, '⏩']));
    bottom.style.visibility = s ? 'visible' : 'hidden';
  }
}

// Botones ⬇️ / ⬆️
function transpose(steps) {
  // 12 semitonos = una octava = mismo tono: el contador vuelve a 0 al llegar a ±12
  transposeSteps = ((transposeSteps + steps) % 12) || 0;
  // Se parte siempre de la canción original, así al volver a 0 queda exactamente igual que en el Sheet
  song = parseSong(SONGS[currentIndex].chordpro);
  if (transposeSteps !== 0) song = song.transpose(transposeSteps);
  renderSong();
  updateLinkInAddressBar(false);   // el enlace lleva el tono actual (#205/+2)
  rememberListTone();               // si se ve desde Mi lista, la lista guarda este tono
}


// ── 10. BOTONES: DO-RE-MI, SOLO LETRA, MODO NOCHE, TAMAÑO DE LETRA ───────────
// Los botones de dos estados muestran lo que pasará al pulsarlos.

function toggleNotation() {
  useSpanishNotation = !useSpanishNotation;
  savePref('cancionero.spanish', useSpanishNotation);
  updateNotationButton();
  if (currentIndex !== null) renderSong();
}

function updateNotationButton() {
  document.getElementById('notation-toggle').textContent =
    useSpanishNotation ? 'C-D-E' : 'Do-Re-Mi';
}

function toggleLyricsOnly() {
  lyricsOnly = !lyricsOnly;
  savePref('cancionero.lyricsOnly', lyricsOnly);
  updateLyricsButton();
  if (currentIndex !== null) renderSong();
}

// "C" tachada = quitar acordes · "C" normal = volver a mostrarlos
function updateLyricsButton() {
  const btn = document.getElementById('lyrics-toggle');
  btn.classList.toggle('crossed', !lyricsOnly);
  btn.title = lyricsOnly ? 'Mostrar acordes' : 'Solo letra (quitar acordes)';
  btn.setAttribute('aria-label', btn.title);
}

// (el modo noche al abrir la página se aplica en index.html, antes de pintarla)
function toggleDark() {
  const dark = document.body.classList.toggle('dark');
  savePref('cancionero.dark', dark);
  updateDarkButton();
}

function updateDarkButton() {
  document.getElementById('dark-toggle').textContent =
    document.body.classList.contains('dark') ? '☀️' : '🌙';
}

// A- / A+ (de 10 a 24 px)
function changeFontSize(delta) {
  fontSize = Math.max(10, Math.min(24, fontSize + delta));
  savePref('cancionero.fontSize', fontSize);
  if (currentIndex !== null) renderSong();
}


// ── 11. ENLACE DIRECTO A UNA CANCIÓN Y COMPARTIR ─────────────────────────────
// La dirección lleva la canción y el tono: …/cancionero/#205 o #205/+2 (semitonos)

function songLink() {
  const s = SONGS[currentIndex];
  return '#' + encodeURIComponent(s.code) +
    (transposeSteps ? '/' + (transposeSteps > 0 ? '+' : '') + transposeSteps : '');
}

function updateLinkInAddressBar(addStep) {
  const url = location.pathname + location.search + songLink();
  if (addStep) history.pushState(null, '', url);
  else         history.replaceState(null, '', url);
}

// Lee la dirección: devuelve { index, steps } o null si no hay canción o no existe
function songFromLink() {
  const m = decodeURIComponent(location.hash.slice(1)).match(/^([^\/]+)(?:\/([+-]?\d+))?$/);
  if (!m) return null;
  const code  = m[1].trim().toLowerCase();
  const index = SONGS.findIndex(s => s.code.toLowerCase() === code);
  if (index === -1) return null;
  return { index, steps: parseInt(m[2] || '0', 10) };
}

// Al abrir la web con un enlace: se deja la lista "debajo" en el historial, para que "atrás" vuelva a ella
function openFromLink() {
  if (!location.hash) return;
  if (openSharedListFromLink()) return;   // enlace a una lista (#lista=…), apartado 12d
  const found = songFromLink();
  history.replaceState(null, '', location.pathname + location.search);   // la lista, sin canción
  if (found) loadSong(found.index, found.steps, true);
}

// Botones "atrás" / "adelante" del navegador o del móvil
window.addEventListener('popstate', () => {
  const found = songFromLink();
  if (found) loadSong(found.index, found.steps, false);
  else if (currentIndex !== null) closeSong();
  if (!found && SONGS.length && newSharedListInLink()) openSharedListFromLink();   // enlace de lista pegado con la web abierta (12d)
});

// Botón 📤: en el móvil, menú de compartir del teléfono; en el ordenador, copia el enlace
async function shareSong() {
  const s     = SONGS[currentIndex];
  const url   = location.href;
  const title = `${s.code} · ${s.title}` + (transposeSteps ? ` (${formatTones(transposeSteps)})` : '');
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.share) {
    try { await navigator.share({ title, text: title, url }); } catch (e) {}   // cancelar no es un error
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Enlace copiado');
  } catch (e) {
    showToast('Copia este enlace: ' + url);
  }
}

// Aviso corto abajo de la pantalla
let toastTimer = null;
function showToast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), text.length > 20 ? 6000 : 2500);
}


// ── 12. BOTÓN FLOTANTE 🔍 ────────────────────────────────────────────────────
// Aparece cuando el cuadro de búsqueda ya no se ve; al pulsarlo sube arriba (sin abrir el teclado)

function updateTopButton() {
  const search = document.getElementById('search');
  const hidden = window.scrollY > search.offsetTop + search.offsetHeight;
  document.getElementById('top-btn').classList.toggle('show', hidden);
}

function goToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.addEventListener('scroll', updateTopButton, { passive: true });


// ── 12b. IMPRIMIR / GUARDAR EN PDF (🖨️) ──────────────────────────────────────
// Abre la ventana de imprimir del navegador, que también tiene "Guardar como PDF".
// Se imprime la canción tal como se ve (tono, Do-Re-Mi, solo letra). El aspecto en papel
// está en estilos.css (apartado IMPRIMIR). Mientras se imprime, el título de la página es
// el de la canción, para que el PDF se guarde con ese nombre ("205 · Título (+1 tono)").

const PAGE_TITLE = document.title;
function printSong() {
  const s = SONGS[currentIndex];
  document.title = `${s.code} · ${s.title}` + (transposeSteps ? ` (${formatTones(transposeSteps)})` : '');
  window.print();
}
window.addEventListener('afterprint', () => { document.title = PAGE_TITLE; });


// ── 12c. MIS LISTAS (📋) ─────────────────────────────────────────────────────
// Listas de canciones propias con nombre (p. ej. "Misa domingo", "Convivencias"), guardadas en
// el navegador de cada uno. El botón 📋 de arriba activa o desactiva el "modo lista": con él
// activado se ve la lista elegida encima del buscador, y sale un ➕ en cada canción (en la lista
// general y dentro de la canción abierta); ✓ = ya está en la lista (pulsar para quitarla). Sin
// el modo lista la web se ve como siempre y las listas no se borran.
// - El título del recuadro es un desplegable para elegir la lista o crear una nueva;
//   ✏️ cambia el nombre y 🗑️ borra la lista (pulsando dos veces).
// - Ordenar con ⬆ ⬇ y quitar con ✕.
// - Cada canción recuerda su tono: el que tenía al añadirla desde dentro, y el que se le ponga
//   después mientras se ve desde la lista.
// - Al abrir una canción desde la lista, ⏪ ⏩ pasan por la lista, cada una en su tono.
// Se guarda por código ({ code, steps }), así sigue valiendo aunque se reordene el Sheet.
// Si una canción ya no está en el Sheet, no sale.
// (Hasta la versión 4 había una sola lista, "cancionero.myList": al abrir esta versión pasa a ser
// la lista "Mi lista", sin perder nada.)

const DEFAULT_LIST_NAME = 'Mi lista';
let listMode         = loadPref('cancionero.listMode', false) === true;
let lists            = loadLists();   // [{ name, songs: [{ code, steps }] }]
let activeList       = Math.min(Math.max(0, Math.floor(Number(loadPref('cancionero.activeList', 0)) || 0)), lists.length - 1);
let myList           = lists[activeList].songs;   // canciones de la lista elegida
let openedFromMyList = false;    // la canción abierta se ha abierto desde la lista
let listEdit         = null;     // escribiendo un nombre: 'new' (lista nueva) o 'rename' (cambiar nombre)
let deleteConfirm    = false;    // 🗑️ pulsado una vez: falta confirmar

// Canciones guardadas, limpias: [{ code, steps }]
function cleanSongs(saved) {
  return Array.isArray(saved)
    ? saved.filter(e => e && typeof e.code === 'string')
           .map(e => ({ code: e.code, steps: (Number(e.steps) % 12) || 0 }))
    : [];
}

function loadLists() {
  const saved = loadPref('cancionero.lists', null);
  const list = Array.isArray(saved)
    ? saved.filter(l => l && typeof l.name === 'string' && l.name.trim())
           .map(l => ({ name: l.name.trim().slice(0, 40), songs: cleanSongs(l.songs) }))
    : [];
  // primera vez con esta versión: la lista de antes pasa a llamarse "Mi lista"
  return list.length ? list : [{ name: DEFAULT_LIST_NAME, songs: cleanSongs(loadPref('cancionero.myList', [])) }];
}

function saveMyList() {
  lists[activeList].songs = myList;
  savePref('cancionero.lists', lists);
  savePref('cancionero.activeList', activeList);
}

function listName() {
  return lists[activeList].name;
}

// Los nombres los escribe la gente (o llegan en un enlace): se muestran como texto, nunca como código
function esc(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Nombre sin repetir: si ya hay una "Misa", la nueva se llama "Misa (2)"
function uniqueName(name, except = -1) {
  let n = name, k = 2;
  while (lists.some((l, i) => i !== except && l.name.toLowerCase() === n.toLowerCase())) n = `${name} (${k++})`;
  return n;
}

// Canciones de una lista que existen en el Sheet: [{ code, steps, index }]
function existingSongs(list) {
  return list
    .map(e => ({ ...e, index: SONGS.findIndex(s => s.code === e.code) }))
    .filter(e => e.index !== -1);
}

// La lista que se ve: la compartida que se está mirando (apartado 12d) o la elegida
function myListSongs() {
  return existingSongs(sharedList || myList);
}

function myListIndexes() {
  return myListSongs().map(e => e.index);
}

// Posición en la lista de una canción (posición en SONGS), o -1
function myListPos(index) {
  return myListIndexes().indexOf(index);
}

// ¿⏪ ⏩ siguen la lista? Si se ha abierto desde ella, el modo lista está activado y sigue en ella
function navigatingMyList() {
  return openedFromMyList && listMode && myListPos(currentIndex) !== -1;
}

// Botón 📋: activa o desactiva el modo lista
function toggleListMode() {
  listMode = !listMode;
  savePref('cancionero.listMode', listMode);
  if (!listMode && sharedList) { closeSharedList(); return; }   // al cerrar, se deja de ver la compartida
  refreshMyList();
}

// Vuelve a pintar todo lo que depende de las listas
function refreshMyList() {
  listEdit      = null;
  deleteConfirm = false;
  document.getElementById('list-toggle').classList.toggle('on', listMode);
  document.getElementById('list-toggle').title = listMode ? 'Cerrar mis listas' : 'Mis listas';
  renderMyList();
  if (SONGS.length) renderList();          // ➕ / ✓ en cada fila (y ⏪ ⏩)
  if (currentIndex !== null) updateViewerListButton();
}

// ➕ / ✓ de cada fila de la lista general (solo en modo lista)
function listAddButton(index) {
  if (!listMode || sharedList) return '';   // mirando una lista compartida no se añade
  const inList = myListPos(index) !== -1;
  const label  = esc((inList ? 'Quitar de «' : 'Añadir a «') + listName() + '»');
  return `<button class="list-add${inList ? ' in-list' : ''}" onclick="event.stopPropagation(); toggleInMyList(${index}, 0)"
    title="${label}" aria-label="${label}">${inList ? '✓' : '➕'}</button>`;
}

// Añade la canción (con el tono indicado) a la lista elegida, o la quita si ya estaba
function toggleInMyList(index, steps) {
  const code = SONGS[index].code;
  const pos  = myList.findIndex(e => e.code === code);
  if (pos === -1) {
    myList.push({ code, steps });
    showToast(`Añadida a «${listName()}»`);
  } else {
    myList.splice(pos, 1);
    showToast(`Quitada de «${listName()}»`);
  }
  myList = existingSongs(myList).map(({ code, steps }) => ({ code, steps }));   // fuera las que ya no existen
  saveMyList();
  refreshMyList();
}

// Botón de dentro de la canción: ➕ Añadir a «Misa» / ✓ En «Misa» (2 de 5)
function updateViewerListButton() {
  const btn = document.getElementById('list-add-btn');
  btn.style.display = listMode ? '' : 'none';
  if (!listMode) return;
  const pos = myListPos(currentIndex);
  btn.disabled = !!sharedList;
  if (sharedList) {   // mirando una lista compartida: solo dice en qué puesto va
    btn.style.display = pos === -1 ? 'none' : '';
    btn.classList.add('in-list');
    btn.textContent = `📋 ${sharedName} (${pos + 1} de ${myListIndexes().length})`;
    btn.title = 'Lista compartida';
    return;
  }
  btn.classList.toggle('in-list', pos !== -1);
  btn.textContent = pos === -1 ? `➕ Añadir a «${listName()}»` : `✓ En «${listName()}» (${pos + 1} de ${myListIndexes().length})`;
  btn.title = pos === -1 ? 'Añadir a la lista con el tono actual' : 'Quitar de la lista';
}

function toggleCurrentInMyList() {
  toggleInMyList(currentIndex, transposeSteps);   // se guarda con el tono que tiene ahora
}

// Abre la canción que está en la posición pos de la lista, en su tono guardado
function openMyListSong(pos) {
  const e = myListSongs()[pos];
  if (e) loadSong(e.index, e.steps, true, true);
}

// Si la canción abierta se ve desde la lista, la lista guarda su tono nuevo
function rememberListTone() {
  if (!navigatingMyList()) return;
  const code = SONGS[currentIndex].code;
  const e = (sharedList || myList).find(e => e.code === code);
  if (e) { e.steps = transposeSteps; if (!sharedList) saveMyList(); renderMyList(); }
}

// ⬆ (delta = -1) / ⬇ (+1): mueve la canción de la posición pos
function moveInMyList(pos, delta) {
  const list = myListSongs().map(({ code, steps }) => ({ code, steps }));
  const to = pos + delta;
  if (to < 0 || to >= list.length) return;
  [list[pos], list[to]] = [list[to], list[pos]];
  myList = list;
  saveMyList();
  refreshMyList();
}

function removeFromMyList(pos) {
  toggleInMyList(myListSongs()[pos].index, 0);
}

// Desplegable: elegir otra lista, o "Nueva lista…"
function selectList(value) {
  if (value === 'new') {
    listEdit = 'new';
    deleteConfirm = false;
    renderMyList();
    return;
  }
  activeList = Math.min(Math.max(0, Number(value) || 0), lists.length - 1);
  myList = lists[activeList].songs;
  saveMyList();
  refreshMyList();
}

// ✏️ Cambiar el nombre
function startRenameList() {
  listEdit = 'rename';
  deleteConfirm = false;
  renderMyList();
}

// ✔ del cuadro del nombre (o tecla Intro): crea la lista nueva o cambia el nombre
function confirmListName() {
  const input = document.getElementById('list-name-input');
  const typed = (input ? input.value : '').trim().slice(0, 40);
  if (listEdit === 'new') {
    lists.push({ name: uniqueName(typed || `Lista ${lists.length + 1}`), songs: [] });
    activeList = lists.length - 1;
    myList = lists[activeList].songs;
    showToast(`Lista «${listName()}» creada`);
  } else if (listEdit === 'rename' && typed) {
    lists[activeList].name = uniqueName(typed, activeList);
  }
  saveMyList();
  refreshMyList();
}

function cancelListName() {
  refreshMyList();
}

function listNameKey(event) {
  if (event.key === 'Enter') confirmListName();
  if (event.key === 'Escape') cancelListName();
}

// 🗑️ Borrar la lista elegida (la primera pulsación solo pide confirmar). Si era la única,
// queda una "Mi lista" vacía.
function deleteList() {
  if (!deleteConfirm) {
    deleteConfirm = true;
    listEdit = null;
    renderMyList();
    return;
  }
  const name = listName();
  lists.splice(activeList, 1);
  if (!lists.length) lists.push({ name: DEFAULT_LIST_NAME, songs: [] });
  activeList = Math.max(0, activeList - 1);
  myList = lists[activeList].songs;
  saveMyList();
  showToast(`Lista «${name}» borrada`);
  refreshMyList();
}

// El recuadro de las listas (encima del buscador)
function renderMyList() {
  const box = document.getElementById('my-list');
  box.style.display = listMode ? 'block' : 'none';
  if (!listMode) return;
  const songs = myListSongs();
  const count = songs.length ? ` <span class="my-list-count">(${songs.length})</span>` : '';
  let html;
  if (sharedList) {
    html = `<div class="my-list-title">📋 ${esc(sharedName)}${count}</div>
       <p class="my-list-empty">Lista compartida contigo</p>
       <div class="shared-buttons">
         <button class="shared-save" onclick="saveSharedList()">💾 Guardar en mis listas</button>
         <button onclick="closeSharedList()" title="Volver a mis listas">✕ Cerrar</button>
       </div>`;
  } else {
    const options = lists.map((l, i) =>
      `<option value="${i}"${i === activeList ? ' selected' : ''}>${esc(l.name)}</option>`).join('');
    html = `<div class="my-list-title">📋
         <select id="list-select" onchange="selectList(this.value)" aria-label="Elegir lista">${options}<option value="new">➕ Nueva lista…</option></select>${count}
         <span class="list-tools">
           <button onclick="startRenameList()" title="Cambiar el nombre" aria-label="Cambiar el nombre">✏️</button>
           <button onclick="deleteList()" title="Borrar la lista" aria-label="Borrar la lista">🗑️</button>
           ${songs.length ? '<button id="share-list-btn" onclick="shareMyList()" title="Compartir la lista" aria-label="Compartir la lista">📤</button>' : ''}
         </span></div>`;
    if (listEdit) {
      const value = listEdit === 'rename' ? listName() : '';
      const placeholder = listEdit === 'new' ? 'Nombre de la lista nueva' : 'Nombre de la lista';
      html += `<div class="list-name-edit">
         <input id="list-name-input" maxlength="40" value="${esc(value)}" placeholder="${placeholder}" onkeydown="listNameKey(event)">
         <button class="shared-save" onclick="confirmListName()">✔ ${listEdit === 'new' ? 'Crear' : 'Guardar'}</button>
         <button onclick="cancelListName()">✕</button>
       </div>`;
    }
    if (deleteConfirm) {
      html += `<div class="shared-buttons">
         <button class="delete-confirm" onclick="deleteList()">¿Borrar «${esc(listName())}»? Pulsa otra vez</button>
         <button onclick="refreshMyList()">✕ No</button>
       </div>`;
    }
  }
  if (!SONGS.length) {
    html += '<p class="my-list-empty">Cargando canciones...</p>';
  } else if (!songs.length) {
    html += '<p class="my-list-empty">Está vacía. Pulsa ➕ en una canción para añadirla.</p>';
  } else {
    html += '<ol>' + songs.map((e, pos) => {
      const s = SONGS[e.index];
      const active = navigatingMyList() && e.index === currentIndex;
      const tone = e.steps ? `<span class="my-list-tone">${formatTones(e.steps)}</span>` : '';
      return `<li class="${active ? 'active' : ''}" onclick="openMyListSong(${pos})">
        <span class="my-list-num">${pos + 1}</span>
        <span class="my-list-name"><span class="song-code">${s.code}</span>${s.title}</span>${tone}
        ${sharedList ? '' : `<span class="my-list-buttons">
          <button onclick="event.stopPropagation(); moveInMyList(${pos}, -1)" ${pos === 0 ? 'disabled' : ''} title="Subir" aria-label="Subir">⬆️</button>
          <button onclick="event.stopPropagation(); moveInMyList(${pos}, 1)" ${pos === songs.length - 1 ? 'disabled' : ''} title="Bajar" aria-label="Bajar">⬇️</button>
          <button onclick="event.stopPropagation(); removeFromMyList(${pos})" title="Quitar de la lista" aria-label="Quitar de la lista">✕</button>
        </span>`}
      </li>`;
    }).join('') + '</ol>';
  }
  box.innerHTML = html;
  const input = document.getElementById('list-name-input');
  if (input) { input.focus(); input.select(); }
}


// ── 12d. COMPARTIR UNA LISTA CON UN ENLACE ───────────────────────────────────
// El 📤 del recuadro comparte un enlace con las canciones en orden, el tono de cada una (en
// semitonos, como el de una canción) y el nombre de la lista:
//   …/cancionero/#lista=H03+2,205,302-1&nombre=Misa%20domingo
// (los enlaces de la versión 4, sin "&nombre=", siguen valiendo: se llaman "Lista compartida").
// Quien lo abre ve la lista arriba (se activa el modo lista), sin tocar sus listas: puede abrir
// las canciones (en su tono, con ⏪ ⏩), y "💾 Guardar en mis listas" la guarda como una lista
// nueva con ese nombre. Si solo tiene una lista y está vacía, se guarda directamente en su
// lugar. "✕ Cerrar" vuelve a sus listas.
// Mientras se mira, la dirección conserva el #lista=… (así "atrás" y recargar la mantienen).

const SHARED_DEFAULT_NAME = 'Lista compartida';
let sharedList = null;    // lista compartida que se está mirando ([{ code, steps }]) o null
let sharedName = '';      // su nombre

// Enlace de la lista que se ve
function listLink() {
  const items = myListSongs().map(e =>
    encodeURIComponent(e.code) + (e.steps ? (e.steps > 0 ? '+' : '') + e.steps : ''));
  const name = sharedList ? sharedName : listName();
  return location.origin + location.pathname + '#lista=' + items.join(',') + '&nombre=' + encodeURIComponent(name);
}

// Partes de un enlace de lista: { codes, name } sin descodificar, o null si no lo es
function listLinkParts() {
  const m = location.hash.slice(1).match(/^lista=([^&]*)(?:&nombre=(.*))?$/i);
  return m ? { codes: m[1], name: m[2] || '' } : null;
}

function safeDecode(text) {
  try { return decodeURIComponent(text); } catch (e) { return text; }
}

// Lee un enlace de lista: [{ code, steps }] (solo las canciones que existen), o null si no lo es
function sharedListFromLink() {
  const parts = listLinkParts();
  if (!parts) return null;
  const list = [];
  for (const item of safeDecode(parts.codes).split(',')) {
    const p = item.trim().match(/^([^+\-\s]+)([+-]\d+)?$/);
    if (!p) continue;
    const s = SONGS.find(s => s.code.toLowerCase() === p[1].toLowerCase());
    if (s && !list.some(e => e.code === s.code))
      list.push({ code: s.code, steps: (parseInt(p[2] || '0', 10) % 12) || 0 });
  }
  return list;
}

// Nombre que trae el enlace (o "Lista compartida" si no trae)
function sharedNameFromLink() {
  const parts = listLinkParts();
  const name = parts ? safeDecode(parts.name).trim().slice(0, 40) : '';
  return name || SHARED_DEFAULT_NAME;
}

// ¿La dirección lleva una lista distinta de la que ya se ve? (p. ej. se pega un enlace con la web abierta)
function newSharedListInLink() {
  const list = sharedListFromLink();
  return list !== null && JSON.stringify(list) !== JSON.stringify(sharedList || myList);
}

// Al abrir la web con un enlace de lista. Devuelve true si lo era.
function openSharedListFromLink() {
  const list = sharedListFromLink();
  if (list === null) return false;
  const name = sharedNameFromLink();
  listMode = true;
  savePref('cancionero.listMode', true);
  if (!list.length) {                          // ninguna canción válida: la web normal
    history.replaceState(null, '', location.pathname + location.search);
    refreshMyList();
  } else if (lists.length === 1 && !existingSongs(myList).length) {   // una sola lista y vacía: se guarda en su lugar
    lists[0] = { name: name === SHARED_DEFAULT_NAME ? DEFAULT_LIST_NAME : name, songs: list };
    activeList = 0;
    myList = lists[0].songs;
    saveMyList();
    history.replaceState(null, '', location.pathname + location.search);
    refreshMyList();
    showToast(`Lista «${listName()}» guardada`);
  } else {
    sharedList = list;
    sharedName = name;
    refreshMyList();
  }
  window.scrollTo(0, 0);
  return true;
}

// Deja la dirección sin #lista=… (si hay una canción abierta, ya lleva la suya)
function clearListLink() {
  if (currentIndex === null) history.replaceState(null, '', location.pathname + location.search);
}

// 💾 Guardar en mis listas: se guarda como una lista nueva con su nombre, y queda elegida
function saveSharedList() {
  lists.push({ name: uniqueName(sharedName), songs: sharedList.map(({ code, steps }) => ({ code, steps })) });
  activeList = lists.length - 1;
  myList = lists[activeList].songs;
  saveMyList();
  sharedList = null;
  clearListLink();
  refreshMyList();
  showToast(`Guardada en tus listas: «${listName()}»`);
}

// ✕ Cerrar: se deja de mirar la lista compartida y se vuelve a las listas propias
function closeSharedList() {
  sharedList = null;
  clearListLink();
  refreshMyList();
}

// 📤 de la lista: en el móvil, menú de compartir del teléfono; en el ordenador, copia el enlace
async function shareMyList() {
  const songs = myListSongs();
  const url   = listLink();
  const title = `${sharedList ? sharedName : listName()} (${songs.length} ${songs.length === 1 ? 'canción' : 'canciones'})`;
  const text  = title + ':\n' + songs.map((e, i) => {
    const s = SONGS[e.index];
    return `${i + 1}. ${s.code} · ${s.title}` + (e.steps ? ` (${formatTones(e.steps)})` : '');
  }).join('\n');
  const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.share) {
    try { await navigator.share({ title, text, url }); } catch (e) {}   // cancelar no es un error
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast('Enlace de la lista copiado');
  } catch (e) {
    showToast('Copia este enlace: ' + url);
  }
}


// ── 12e. SIN CONEXIÓN (sw.js) ────────────────────────────────────────────────
// El archivo sw.js guarda en el navegador la web y las canciones cada vez que se abren con
// conexión, y las usa cuando no la hay (siempre pide primero lo nuevo a internet).
// Aquí: se activa sw.js, y si las canciones vienen de la copia guardada sale un aviso arriba
// "📴 Sin conexión: canciones guardadas el 24/11/2026 a las 20:15".

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function sheetCopyInfo(resp, text) {
  const note = document.getElementById('offline-note');
  if (resp.headers.get('X-Cancionero-Copia')) {
    const when = new Date(resp.headers.get('X-Cancionero-Guardado') || '');
    const date = isNaN(when) ? '' : ` el ${when.toLocaleDateString('es-ES')} a las ${when.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    note.textContent = `📴 Sin conexión: canciones guardadas${date}.`;
    note.style.display = 'block';
    return;
  }
  note.style.display = 'none';
  // Copia de las canciones (la guarda también la página, porque la primera vez que se abre la
  // web sw.js aún no está funcionando)
  if (window.caches) {
    const headers = { 'Content-Type': 'text/csv; charset=utf-8', 'X-Cancionero-Guardado': new Date().toISOString() };
    caches.open('cancionero').then(c => c.put(SHEET_CSV_URL, new Response(text, { headers }))).catch(() => {});
  }
}


// ── 13. INICIO ───────────────────────────────────────────────────────────────
updateNotationButton();
updateLyricsButton();
updateDarkButton();
refreshMyList();
loadFromSheet();
