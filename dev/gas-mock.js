/**
 * Simulador mínimo de Google Apps Script para correr apps-script/Code.gs en Node.
 * Imita lo que usa el backend: SpreadsheetApp, Utilities, CacheService,
 * PropertiesService, LockService, DriveApp, ContentService y Session.
 *
 * También imita detalles de Sheets que suelen causar bugs:
 *  - textos numéricos se convierten en número salvo en columnas con formato '@'
 *  - un apóstrofo inicial fuerza texto (y no se guarda)
 *  - las validaciones de lista rechazan valores inválidos
 *  - CacheService rechaza valores de más de 100 KB
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE_PATH = path.join(__dirname, '..', 'apps-script', 'Code.gs');

function aBytesConSigno(buf) {
  return Array.from(buf, (b) => (b > 127 ? b - 256 : b));
}

function desdeBytes(bytes) {
  return Buffer.from(bytes.map((b) => b & 0xff));
}

// ---------- Fechas con zona horaria ----------

function partesEnZona(fecha, zona) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = {};
  fmt.formatToParts(fecha).forEach((x) => { p[x.type] = x.value; });
  return p;
}

function desfaseZona(ms, zona) {
  const p = partesEnZona(new Date(ms), zona);
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

function formatDate(fecha, zona, patron) {
  const p = partesEnZona(fecha, zona);
  return patron
    .replace(/yyyy/g, p.year)
    .replace(/MM/g, p.month)
    .replace(/dd/g, p.day)
    .replace(/HH/g, p.hour)
    .replace(/mm/g, p.minute)
    .replace(/ss/g, p.second);
}

const esFecha = (v) => Object.prototype.toString.call(v) === '[object Date]';

function parseDate(texto, zona, patron, Fecha = Date) {
  let m;
  if (patron === 'yyyy-MM-dd' && (m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return new Fecha(local - desfaseZona(local, zona));
  }
  throw new Error('parseDate: patrón no soportado en el simulador: ' + patron);
}

// ---------- Hojas ----------

class MockRange {
  constructor(sheet, fila, col, filas, cols) {
    if (fila < 1 || col < 1 || filas < 1 || cols < 1) {
      throw new Error(`Rango inválido (${fila}, ${col}, ${filas}, ${cols})`);
    }
    Object.assign(this, { sheet, fila, col, filas, cols });
  }
  getRow() { return this.fila; }
  getColumn() { return this.col; }
  getNumRows() { return this.filas; }
  getNumColumns() { return this.cols; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.filas; r++) {
      const fila = [];
      for (let c = 0; c < this.cols; c++) fila.push(this.sheet._leer(this.fila + r, this.col + c));
      out.push(fila);
    }
    return out;
  }
  getValue() { return this.sheet._leer(this.fila, this.col); }
  setValues(valores) {
    if (!Array.isArray(valores) || valores.length !== this.filas || valores.some((f) => f.length !== this.cols)) {
      throw new Error(`setValues: las dimensiones no coinciden (rango ${this.filas}x${this.cols})`);
    }
    valores.forEach((f, r) => f.forEach((v, c) => this.sheet._escribir(this.fila + r, this.col + c, v)));
    return this;
  }
  setValue(v) {
    for (let r = 0; r < this.filas; r++) for (let c = 0; c < this.cols; c++) this.sheet._escribir(this.fila + r, this.col + c, v);
    return this;
  }
  setNumberFormat(f) {
    for (let r = 0; r < this.filas; r++) for (let c = 0; c < this.cols; c++) this.sheet.formatos.set(`${this.fila + r},${this.col + c}`, f);
    return this;
  }
  setDataValidation(regla) {
    for (let r = 0; r < this.filas; r++) for (let c = 0; c < this.cols; c++) this.sheet.validaciones.set(`${this.fila + r},${this.col + c}`, regla);
    return this;
  }
  clearContent() { return this.setValue(''); }
  setFontWeight() { return this; }
  setFontColor() { return this; }
  setFontSize() { return this; }
  setBackground() { return this; }
  setHorizontalAlignment() { return this; }
  setWrap() { return this; }
  setNote() { return this; }
  activate() { return this; }
}

class MockSheet {
  constructor(ss, nombre) {
    this.ss = ss;
    this.nombre = nombre;
    this.datos = [];
    this.formatos = new Map();
    this.validaciones = new Map();
    this.maxFilas = 1000;
    this.maxCols = 26;
    this.reglasCondicionales = [];
    this.formulasEscritas = [];
  }
  getName() { return this.nombre; }
  getMaxRows() { return this.maxFilas; }
  getMaxColumns() { return this.maxCols; }
  getLastRow() {
    for (let r = this.datos.length; r >= 1; r--) {
      const f = this.datos[r - 1];
      if (f && f.some((v) => v !== '' && v !== null && v !== undefined)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.datos.forEach((f) => {
      if (!f) return;
      for (let c = f.length; c >= 1; c--) if (f[c - 1] !== '' && f[c - 1] !== undefined) { max = Math.max(max, c); break; }
    });
    return max;
  }
  getRange(fila, col, filas, cols) {
    if (typeof fila === 'string') throw new Error('El simulador no soporta notación A1: ' + fila);
    return new MockRange(this, fila, col, filas || 1, cols || 1);
  }
  getDataRange() {
    return new MockRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  appendRow(valores) {
    const fila = this.getLastRow() + 1;
    valores.forEach((v, i) => this._escribir(fila, i + 1, v));
    return this;
  }
  deleteRow(fila) {
    this.datos.splice(fila - 1, 1);
    return this;
  }
  clear() {
    this.datos = [];
    this.formatos.clear();
    this.validaciones.clear();
    return this;
  }
  setFrozenRows() { return this; }
  setColumnWidth() { return this; }
  setTabColor() { return this; }
  autoResizeColumns() { return this; }
  setConditionalFormatRules(reglas) { this.reglasCondicionales = reglas; return this; }
  getConditionalFormatRules() { return this.reglasCondicionales; }

  _leer(fila, col) {
    const f = this.datos[fila - 1];
    const v = f ? f[col - 1] : undefined;
    if (v === undefined || v === null) return '';
    // Las fechas se entregan como Date del contexto del script (otro "realm").
    return esFecha(v) ? new this.ss.Fecha(v.getTime()) : v;
  }
  _escribir(fila, col, v) {
    if (fila > this.maxFilas) this.maxFilas = fila;
    if (col > this.maxCols) this.maxCols = col;
    const clave = `${fila},${col}`;
    const formato = this.formatos.get(clave);
    let valor = v;
    if (valor === null || valor === undefined) valor = '';
    else if (esFecha(valor)) valor = new Date(valor.getTime());
    else if (typeof valor === 'string') {
      if (valor.startsWith("'")) valor = valor.slice(1);
      else if (formato === '@') { /* texto */ }
      else if (/^=/.test(valor)) this.formulasEscritas.push({ fila, col, valor });
      else if (/^-?\d+(\.\d+)?$/.test(valor.trim())) valor = Number(valor);
      else if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) valor = parseDate(valor, this.ss.zona, 'yyyy-MM-dd');
    }
    const regla = this.validaciones.get(clave);
    if (regla && regla.lista && !regla.permitirInvalido && valor !== '' && !regla.lista.includes(valor)) {
      throw new Error(`Los datos que ingresaste en la celda ${this.nombre}!${fila},${col} infringen las reglas de validación: "${valor}"`);
    }
    while (this.datos.length < fila) this.datos.push([]);
    const f = this.datos[fila - 1];
    while (f.length < col) f.push('');
    f[col - 1] = valor;
  }
}

class MockSpreadsheet {
  constructor() {
    this.hojas = [];
    this.zona = 'America/Caracas';
    this.toasts = [];
    this.activa = null;
    this.Fecha = Date;
  }
  getId() { return 'mock-spreadsheet'; }
  getSheetByName(n) { return this.hojas.find((h) => h.nombre === n) || null; }
  getSheets() { return this.hojas.slice(); }
  insertSheet(n) {
    if (this.getSheetByName(n)) throw new Error('Ya existe una hoja llamada ' + n);
    const h = new MockSheet(this, n);
    this.hojas.push(h);
    return h;
  }
  setSpreadsheetTimeZone(z) { this.zona = z; }
  getSpreadsheetTimeZone() { return this.zona; }
  setActiveSheet(h) { this.activa = h; return h; }
  moveActiveSheet(pos) {
    const i = this.hojas.indexOf(this.activa);
    this.hojas.splice(i, 1);
    this.hojas.splice(pos - 1, 0, this.activa);
  }
  toast(msg, titulo) { this.toasts.push({ titulo, msg }); }
}

function encadenable(resultado) {
  const p = new Proxy({}, {
    get(_, prop) {
      if (prop === 'build') return () => resultado;
      return () => p;
    },
  });
  return p;
}

// ---------- Servicios ----------

function crearServicios(opciones) {
  const ss = new MockSpreadsheet();
  const ui = {
    alertas: [],
    respuestasPrompt: [],
    respuestaAlert: 'YES',
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' },
    Button: { OK: 'OK', CANCEL: 'CANCEL', YES: 'YES', NO: 'NO' },
    alert(titulo, msg) { this.alertas.push({ titulo, msg }); return this.respuestaAlert; },
    prompt(titulo, msg) {
      const r = this.respuestasPrompt.shift() || { boton: 'CANCEL', texto: '' };
      return { getSelectedButton: () => r.boton, getResponseText: () => r.texto };
    },
    createMenu() { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => undefined }; return m; },
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ss,
    getUi: () => {
      if (opciones.sinUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');
      return ui;
    },
    newDataValidation() {
      const regla = { lista: null, permitirInvalido: true };
      const b = {
        requireValueInList(lista) { regla.lista = lista.slice(); return b; },
        setAllowInvalid(v) { regla.permitirInvalido = v; return b; },
        build() { return regla; },
      };
      return b;
    },
    newConditionalFormatRule: () => encadenable({ condicional: true }),
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(alg, texto) {
      if (alg !== 'SHA_256') throw new Error('Algoritmo no soportado');
      return aBytesConSigno(crypto.createHash('sha256').update(String(texto), 'utf8').digest());
    },
    getUuid: () => crypto.randomUUID(),
    base64Decode(s) {
      if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('Could not decode string.');
      return aBytesConSigno(Buffer.from(s, 'base64'));
    },
    base64Encode: (bytes) => desdeBytes(bytes).toString('base64'),
    newBlob: (bytes, tipo, nombre) => new MockBlob(bytes, tipo, nombre),
    formatDate,
    parseDate: (texto, zona, patron) => parseDate(texto, zona, patron, ss.Fecha),
    sleep() {},
  };

  const cacheMapa = new Map();
  const cache = {
    get(k) {
      const e = cacheMapa.get(k);
      if (!e || e.expira < Date.now()) return null;
      return e.v;
    },
    put(k, v, seg) {
      if (Buffer.byteLength(String(v), 'utf8') > 100 * 1024) throw new Error('Argument too large: value');
      cacheMapa.set(k, { v: String(v), expira: Date.now() + (seg || 600) * 1000 });
    },
    getAll(claves) {
      const o = {};
      claves.forEach((k) => { const v = cache.get(k); if (v !== null) o[k] = v; });
      return o;
    },
    putAll(obj, seg) { Object.keys(obj).forEach((k) => cache.put(k, obj[k], seg)); },
    remove(k) { cacheMapa.delete(k); },
    removeAll(claves) { claves.forEach((k) => cacheMapa.delete(k)); },
    _vaciar() { cacheMapa.clear(); },
  };
  const CacheService = { getScriptCache: () => cache };

  const props = new Map();
  const propiedades = {
    getProperty: (k) => (props.has(k) ? props.get(k) : null),
    setProperty(k, v) {
      if (Buffer.byteLength(String(v), 'utf8') > 9 * 1024) throw new Error('Valor de propiedad demasiado grande');
      props.set(k, String(v));
      return propiedades;
    },
    deleteProperty(k) { props.delete(k); return propiedades; },
    getProperties: () => Object.fromEntries(props),
    _mapa: props,
  };
  const PropertiesService = { getScriptProperties: () => propiedades };

  let bloqueado = false;
  const LockService = {
    getScriptLock: () => ({
      tryLock() {
        if (bloqueado) throw new Error('Bloqueo anidado: conBloqueo_ dentro de conBloqueo_');
        bloqueado = true;
        return true;
      },
      waitLock() { this.tryLock(); },
      releaseLock() { bloqueado = false; },
      hasLock: () => bloqueado,
    }),
  };

  const carpetas = new Map();
  const archivos = new Map();
  const idAleatorio = () => crypto.randomBytes(21).toString('base64url').slice(0, 28);
  class MockFile {
    constructor(blob) { this.id = idAleatorio(); this.blob = blob; this.trashed = false; }
    getId() { return this.id; }
    getName() { return this.blob.nombre; }
    getUrl() { return `https://drive.google.com/file/d/${this.id}/view?usp=drivesdk`; }
    getBlob() { return this.blob; }
    getMimeType() { return this.blob.tipo; }
    setTrashed(v) { this.trashed = v; return this; }
    isTrashed() { return this.trashed; }
  }
  class MockFolder {
    constructor(nombre) { this.id = idAleatorio(); this.nombre = nombre; this.archivos = []; }
    getId() { return this.id; }
    getName() { return this.nombre; }
    createFile(blob) {
      const f = new MockFile(blob);
      archivos.set(f.id, f);
      this.archivos.push(f);
      return f;
    }
  }
  const DriveApp = {
    createFolder(nombre) { const c = new MockFolder(nombre); carpetas.set(c.id, c); return c; },
    getFolderById(id) {
      if (!carpetas.has(id)) throw new Error('No item with the given ID could be found.');
      return carpetas.get(id);
    },
    getFileById(id) {
      if (!archivos.has(id)) throw new Error('No item with the given ID could be found.');
      return archivos.get(id);
    },
    _carpetas: carpetas,
    _archivos: archivos,
  };

  const ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput(contenido) {
      const out = {
        contenido, mime: 'text/plain',
        setMimeType(m) { out.mime = m; return out; },
        getContent: () => contenido,
      };
      return out;
    },
  };

  const Session = { getScriptTimeZone: () => 'America/Caracas' };

  return { ss, ui, cache, propiedades, SpreadsheetApp, Utilities, CacheService, PropertiesService, LockService, DriveApp, ContentService, Session };
}

class MockBlob {
  constructor(bytes, tipo, nombre) { this.bytes = bytes.slice(); this.tipo = tipo; this.nombre = nombre; }
  getBytes() { return this.bytes.slice(); }
  getContentType() { return this.tipo; }
  getName() { return this.nombre; }
}

/**
 * Crea un entorno aislado con el backend cargado.
 * @returns {{ gas: object, servicios: object, api: Function }}
 */
function crearEntorno(opciones = {}) {
  const servicios = crearServicios(opciones);
  const consola = opciones.silencioso
    ? { log() {}, warn() {}, error() {}, info() {} }
    : console;
  const sandbox = {
    SpreadsheetApp: servicios.SpreadsheetApp,
    Utilities: servicios.Utilities,
    CacheService: servicios.CacheService,
    PropertiesService: servicios.PropertiesService,
    LockService: servicios.LockService,
    DriveApp: servicios.DriveApp,
    ContentService: servicios.ContentService,
    Session: servicios.Session,
    Logger: { log: (...a) => consola.log(...a) },
    console: consola,
  };
  const gas = vm.createContext(sandbox);
  servicios.ss.Fecha = vm.runInContext('Date', gas);
  vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), gas, { filename: 'Code.gs' });

  // Por defecto el simulador manda la misma clave que el portal (token_api).
  const apiToken = opciones.apiToken === undefined ? 'copaprosein' : opciones.apiToken;
  function api(action, datos = {}) {
    const salida = gas.doPost({ postData: { contents: JSON.stringify({ action, api_token: apiToken, ...datos }) } });
    if (salida.mime !== 'application/json') throw new Error('La respuesta no es JSON');
    return JSON.parse(salida.getContent());
  }

  return { gas, servicios, api };
}

module.exports = { crearEntorno, formatDate, parseDate };
