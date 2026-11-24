// Pilot Pro: pure UI/state helpers. Windy remains the source of all forecast data.
export const GROUPS = [
  { title: 'WIND & TURBULENCE', layers: [
    { id: 'wind', label: 'Wind', icon: '↝', info: 'Viento previsto en el nivel disponible seleccionado.' },
    { id: 'gust', label: 'Wind gusts', icon: '≋', info: 'Ráfagas previstas según la definición de Windy; no extrapolar a la altitud de vuelo.' },
    { id: 'turbulence', label: 'Turbulence', icon: '≈', info: 'Turbulencia modelada. No descarta turbulencia mecánica, de montaña o convectiva local.' },
    { id: 'ccl', label: 'Thermals', icon: '↑', info: 'Altura prevista de las térmicas; no es una medida directa de intensidad de turbulencia.' },
  ]},
  { title: 'CLOUDS & VISIBILITY', layers: [
    { id: 'lclouds', label: 'Low clouds', icon: '☁', info: 'Cobertura de nubes bajas; no equivale a techo aeronáutico.' },
    { id: 'mclouds', label: 'Mid clouds', icon: '☁', info: 'Cobertura de nubes medias.' },
    { id: 'hclouds', label: 'High clouds', icon: '☁', info: 'Cobertura de nubes altas.' },
    { id: 'cbase', label: 'Cloud base', icon: '↕', info: 'Base nubosa modelada; verifica unidades y referencia en la leyenda de Windy.' },
    { id: 'visibility', label: 'Visibility', icon: '◉', info: 'Visibilidad modelada; no sustituye observaciones en superficie.' },
    { id: 'cloudtop', label: 'Cloud tops', icon: '⇡', info: 'Altura modelada de la parte superior de nubes.' },
  ]},
  { title: 'PRECIPITATION & HAZARDS', layers: [
    { id: 'rain', label: 'Rain / thunder', icon: '☂', info: 'Precipitación y tormentas previstas según el modelo.' },
    { id: 'radar', label: 'Radar', icon: '◎', info: 'Observaciones o extrapolación según Windy. Comprueba cobertura y hora.' },
    { id: 'satellite', label: 'Satellite', icon: '◈', info: 'Imágenes satelitales; comprueba la hora de observación.' },
    { id: 'cape', label: 'CAPE', icon: 'ϟ', info: 'Energía potencial convectiva; por sí sola no predice tormentas ni seguridad de vuelo.' },
    { id: 'icing', label: 'Icing', icon: '❄', info: 'Engelamiento modelado; no demuestra ausencia de hielo en ruta.' },
  ]},
];
export const LAYERS = GROUPS.flatMap(group => group.layers);
const LEVELS = {
  surface: 'Surface', '100m': '100 m (modelo)',
  '975h': '1,100 ft · 975 hPa', '950h': '1,800 ft · 950 hPa',
  '925h': '2,500 ft · 925 hPa', '900h': '3,200 ft · 900 hPa',
  '850h': '4,800 ft · 850 hPa', '800h': '6,400 ft · 800 hPa',
  '700h': '9,900 ft · 700 hPa', '600h': '13,800 ft · 600 hPa',
  '500h': '18,300 ft · 500 hPa', '400h': '23,600 ft · 400 hPa',
  '300h': '30,100 ft · 300 hPa', '250h': '34,000 ft · 250 hPa',
  '200h': '38,700 ft · 200 hPa', '150h': '44,600 ft · 150 hPa', '10h': '10 hPa',
};
const PRODUCTS = { ecmwf: 'ECMWF', gfs: 'GFS', icon: 'ICON', iconEu: 'ICON-EU', iconD2: 'ICON-D2', mblue: 'Meteoblue', radar: 'Radar', satellite: 'Satellite', ecmwfAnalysis: 'ECMWF analysis' };
export const levelLabel = id => LEVELS[id] ?? String(id ?? '—');
export const productLabel = id => PRODUCTS[id] ?? String(id ?? '—');
export const layerLabel = id => LAYERS.find(layer => layer.id === id)?.label ?? String(id ?? '—');
export const KEYS = ['overlay', 'level', 'availLevels', 'product', 'availProducts', 'timestamp', 'particlesAnim'];
function list(value) { return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string'))] : []; }
export function readState(store) {
  const allowed = typeof store.getAllowed === 'function' ? list(store.getAllowed('overlay')) : [];
  return {
    overlay: store.get('overlay'), level: store.get('level'),
    levels: list(store.get('availLevels')), product: store.get('product'),
    products: list(store.get('availProducts')), allowed,
    timestamp: store.get('timestamp'), particles: store.get('particlesAnim'),
  };
}
export function allowedLayer(state, id) { return !state.allowed.length || state.allowed.includes(id); }
export function optionsWithCurrent(options, current) {
  return current && !options.includes(current) ? [current, ...options] : options;
}
export function selectValue(store, key, value) {
  const current = readState(store);
  const valid = key === 'overlay' ? allowedLayer(current, value) && LAYERS.some(x => x.id === value)
    : key === 'level' ? current.levels.includes(value)
    : key === 'product' ? current.products.includes(value)
    : key === 'particlesAnim' ? ['on', 'off'].includes(value) : false;
  if (!valid) return { ok: false, reason: 'No disponible para esta combinación de capa y modelo.' };
  if (store.get(key) === value) return { ok: true };
  try {
    const changed = store.set(key, value);
    if (changed || store.get(key) === value) return { ok: true };
    return { ok: false, reason: 'Windy no aceptó el cambio. Revisa disponibilidad o permisos.' };
  } catch (e) {
    return { ok: false, reason: 'Windy no pudo cambiar esta opción. Intenta nuevamente.' };
  }
}
export function formatTime(timestamp, utc = false) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '—';
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-GT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(utc ? { timeZone: 'UTC' } : {}) }).format(date);
}
