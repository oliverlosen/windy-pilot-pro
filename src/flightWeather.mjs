// Forecast values retain their original vertical reference until terrain is known.
const FT = 3.280839895;
const KT = 1.943844492;
const R = 3440.065;
const HOUR = 3600000;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const value = (obj, key, i) => i >= 0 && finite(obj?.[key]?.[i]) ? obj[key][i] : null;
const scale = (x, n) => finite(x) ? x*n : null;
const range = (x, lo, hi) => finite(x) && x >= lo && x <= hi ? x : null;
export const fmt = (n, digits=0) => finite(n) ? n.toFixed(digits) : '—';
export function cloudPercent(n) {
    if (!finite(n)) return 'Sin dato';
    if (n > 0 && n < 0.1) return '<0.1 %';
    return Number(n.toFixed(1)) + ' %';
}
export function validPoint(p) { return !!p && finite(p.lat) && finite(p.lon) && Math.abs(p.lat)<=90 && Math.abs(p.lon)<=180; }
export function nearestIndex(ts, time) {
    if (!Array.isArray(ts) || !ts.length || !finite(time)) return -1;
    const valid = ts.map((t,i)=>({t,i})).filter(x=>finite(x.t));
    if (!valid.length || time<Math.min(...valid.map(x=>x.t)) || time>Math.max(...valid.map(x=>x.t))) return -1;
    let best = valid[0];
    for (const item of valid) if (Math.abs(item.t-time)<Math.abs(best.t-time)) best=item;
    return Math.abs(best.t-time)<=HOUR/2 ? best.i : -1;
}
export function flightTime(day, clock, zone='GT') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{2}:\d{2}$/.test(clock)||!['GT','UTC'].includes(zone))return NaN;
    const raw=day+'T'+clock+':00Z', t=Date.parse(raw);
    if(!finite(t)||new Date(t).toISOString().slice(0,16)!==raw.slice(0,16))return NaN;
    return t+(zone==='GT'?6*HOUR:0);
}
export function timeFields(t,zone='GT') {
    if(!finite(t))return {day:'',clock:''};
    const iso=new Date(t-(zone==='GT'?6*HOUR:0)).toISOString();
    return {day:iso.slice(0,10),clock:iso.slice(11,16)};
}
// Cloud coverage is a model signal, not cloud clearance or a ceiling.
export function cloudAtAltitude(profile, altitudeFt) {
    if(!finite(altitudeFt))return null;
    const exact=profile.find(p=>Math.abs(p.heightFt-altitudeFt)<1);
    if(exact)return finite(exact.cloudPct)?{pct:exact.cloudPct,levels:exact.id,samples:[exact]}:null;
    const i=profile.findIndex(p=>p.heightFt>altitudeFt);
    if(i<=0)return null;
    const a=profile[i-1],b=profile[i];
    if(!finite(a.cloudPct)||!finite(b.cloudPct))return null;
    return {pct:Math.max(a.cloudPct,b.cloudPct),levels:a.id+' / '+b.id,samples:[a,b]};
}
export function cloudSamplesText(cloud) {
    if (!cloud) return 'Sin cobertura resuelta a esta altitud';
    return cloud.samples.map(p => cloudPercent(p.cloudPct) + ' a ' + fmt(p.heightFt) + ' ft MSL').join(' · ');
}
export function normalizeForecast(payload, terrainM, time, inputFt, reference='MSL') {
    if (!['MSL','AGL'].includes(reference)) throw new Error('Referencia de altitud desconocida.');
    const d = payload?.data ?? {}, m = payload?.meteogram ?? {}, a = payload?.airgram ?? {}, h = payload?.header ?? {};
    const di=nearestIndex(d.ts,time), mi=nearestIndex(m.ts,time), ai=nearestIndex(a.ts,time);
    if (di<0) throw new Error('Hora fuera del pronóstico disponible o sin muestra a ±30 min.');
    const terrain = finite(terrainM) ? terrainM : finite(h.elevation) ? h.elevation : null;
    const modelTerrain = finite(h.modelElevation) ? h.modelElevation : null;
    const terrainFt = scale(terrain,FT);
    const modelTerrainFt = scale(modelTerrain,FT);
    const altitudeFt = reference==='MSL' ? inputFt : finite(terrainFt) ? terrainFt + inputFt : null;
    const groundHeights = [terrain,modelTerrain].filter(finite);
    const floor = groundHeights.length ? Math.max(...groundHeights) : null;
    // Windy can deliver vertical fields in a section or in the main time series.
    // Read each value against its own clock. A missing value stays missing.
    function field(section, index, key) {
        if (Object.hasOwn(section,key)) return value(section,key,index);
        return value(d,key,di);
    }
    const keys = new Set([...Object.keys(m),...Object.keys(d)]);
    const profile = [];
    for (const key of keys) {
        if (!/^gh-\d+h$/.test(key)) continue;
        const id = key.slice(3), height = field(m,mi,key);
        if (!finite(floor) || !finite(height) || height <= floor) continue;
        const heightFt = height * FT;
        profile.push({id,heightFt,aglFt:finite(terrainFt)?heightFt-terrainFt:null,aboveGround:true,
            cloudPct:range(field(m,mi,'cloud-'+id),0,100),
            windKt:scale(range(field(a,ai,'wind-'+id),0,250),KT),
            windDir:range(field(a,ai,'windDir-'+id),0,360)});
    }
    profile.sort((x,y)=>x.heightFt-y.heightFt);
    const surfaceCloud = range(field(m,mi,'cloud-surface'),0,100);
    if (finite(surfaceCloud) && finite(modelTerrain) && modelTerrain >= floor) {
        profile.unshift({id:'surface',heightFt:modelTerrainFt,aglFt:finite(terrainFt)?modelTerrainFt-terrainFt:null,
            cloudPct:surfaceCloud,windKt:null,windDir:null});
    }
    const wind = windAtAltitude(profile,altitudeFt);
    const cloudBaseFt = scale(range(field(m,mi,'cloudBase'),0,30000),FT);
    const cloudBaseMslFt = finite(modelTerrainFt) && finite(cloudBaseFt) ? modelTerrainFt + cloudBaseFt : null;
    const cruiseCloud = cloudAtAltitude(profile,altitudeFt);
    // A base inside an unsampled interval merits review even when bracketing
    // levels are clear. A deck far below cruise does not imply cloud at cruise.
    const below = profile.filter(p=>p.heightFt<=altitudeFt && finite(p.cloudPct)).at(-1);
    const baseInCruiseGap = finite(altitudeFt) && finite(cloudBaseMslFt) &&
        altitudeFt >= cloudBaseMslFt && (!below || below.heightFt < cloudBaseMslFt) &&
        (!cruiseCloud || cruiseCloud.samples.length > 1);
    return { time:d.ts[di], requestedTime:time, airgramTime:ai>=0?a.ts[ai]:null, meteogramTime:mi>=0?m.ts[mi]:null,
        model:h.model??'ECMWF', update:h.update??null, terrainFt, modelTerrainFt,
        altitudeFt,reference,inputFt,clearanceFt:finite(terrainFt)&&finite(altitudeFt)?altitudeFt-terrainFt:null,
        surfaceWindKt:scale(range(value(d,'wind',di),0,250),KT), gustKt:scale(range(value(d,'windGust',di),0,250),KT),
        surfaceDir:range(value(d,'windDir',di),0,360), temperatureC:finite(value(d,'temperature',di))?value(d,'temperature',di)-273.15:null,
        dewPointC:finite(value(m,'dewPoint',mi))?value(m,'dewPoint',mi)-273.15:null,
        rainMm:range(value(d,'precipAmount',di),0,10000), convectiveMm:range(value(d,'precipConvectiveAmount',di),0,10000),
        cloudBaseFt, cloudBaseMslFt, baseInCruiseGap, visibilityM:null, turbulence:null, thermals:null, icing:null,
        profile, wind, cruiseCloud, isDay: value(d,'isDay',di)===1 ? true : value(d,'isDay',di)===0?false:null };
}
export function windAtAltitude(profile, altitudeFt) {
    if (!finite(altitudeFt)) return null;
    const good=p=>finite(p.windKt)&&finite(p.windDir);
    const exact=profile.find(p=>Math.abs(p.heightFt-altitudeFt)<1&&good(p));
    if (exact) return { kt:exact.windKt, dir:exact.windDir, method:exact.id };
    const hi=profile.findIndex(p=>p.heightFt>altitudeFt);
    if (hi<=0) return null;
    const a=profile[hi-1], b=profile[hi];
    if (!good(a)||!good(b)||b.heightFt<=a.heightFt) return null;
    const t=(altitudeFt-a.heightFt)/(b.heightFt-a.heightFt), rad=Math.PI/180;
    // Interpolate components, not angles (e.g. 350° and 010°).
    const u=(1-t)*a.windKt*Math.sin(a.windDir*rad)+t*b.windKt*Math.sin(b.windDir*rad);
    const v=(1-t)*a.windKt*Math.cos(a.windDir*rad)+t*b.windKt*Math.cos(b.windDir*rad);
    return {kt:Math.hypot(u,v),dir:(Math.atan2(u,v)/rad+360)%360,method:a.id+' / '+b.id};
}
export async function loadWeather(api, point, time, altitudeFt, reference='MSL') {
    if(!validPoint(point)||!finite(time)||!finite(altitudeFt)) throw new Error('Coordenadas, hora o altitud no válidas.');
    const options={model:'ecmwf',lat:point.lat,lon:point.lon,days:7,step:1,extended:true,display:'airgram'};
    const [f,e]=await Promise.allSettled([api.getDetailPointForecastData(options),api.getElevation(point.lat,point.lon)]);
    if(f.status!=='fulfilled'||f.value?.status!==200||!f.value.data) throw new Error('No se pudo obtener el pronóstico ECMWF.');
    const terrain=e.status==='fulfilled'&&e.value?.status===200&&finite(e.value.data)?e.value.data:null;
    return normalizeForecast(f.value.data,terrain,time,altitudeFt,reference);
}
export function assess(w, limits={}) {
    const issues=[], missing=['Visibilidad','Techo aeronáutico / METAR / TAF','Turbulencia','Térmicas','Engelamiento','SIGMET / tormentas observadas','Obstáculos y condiciones locales'], unset=[];
    const warn=(factor,detail,severity='CAUTION',overlay=null)=>issues.push({factor,detail,severity,overlay});
    function check(factor,n,limit,unit,lower=false,overlay=null){
        if(!finite(n)){missing.push(factor);return;}
        if(!finite(limit)){unset.push(factor);return;}
        if(lower?n<limit:n>limit)warn(factor,`${fmt(n,1)} ${unit} · límite personal ${fmt(limit,1)} ${unit}`, 'CAUTION',overlay);
    }
    check('Viento superficie',w.surfaceWindKt,limits.wind,'kt',false,'wind');
    check('Ráfagas superficie',w.gustKt,limits.gust,'kt',false,'gust');
    check('Viento en crucero',w.wind?.kt,limits.aloft,'kt',false,'wind');
    if(finite(w.clearanceFt)&&w.clearanceFt<=0)warn('Terreno','Altitud a nivel o por debajo del terreno muestreado.','ALERT');
    else check('Separación del terreno muestreado',w.clearanceFt,limits.clearance,'ft',true);
    if(!finite(w.convectiveMm))missing.push('Precipitación convectiva');
    else if(w.convectiveMm>0)warn('Convección',`${fmt(w.convectiveMm,2)} mm modelados en el intervalo; revisar tormentas.`, 'CAUTION','rain');
    check('Precipitación',w.rainMm,limits.rain,'mm/intervalo',false,'rain');
    check('Base nubosa modelada',w.cloudBaseFt,limits.cloudBase,'ft AGL modelo',true,'cbase');
    if (w.reference==='AGL' && !finite(w.altitudeFt)) missing.push('Conversión AGL a MSL sin elevación del terreno');
    if (!finite(w.modelTerrainFt)) missing.push('Elevación del terreno del modelo');
    const cloudFactor = 'Nubes cerca de crucero';
    if (!w.cruiseCloud) missing.push(cloudFactor);
    else if (!finite(limits.cloudPct)) unset.push(cloudFactor);
    else if (w.cruiseCloud.pct > 0 && w.cruiseCloud.pct >= limits.cloudPct)
        warn(cloudFactor, cloudSamplesText(w.cruiseCloud) + ' · umbral ' + cloudPercent(limits.cloudPct), 'CAUTION','clouds');
    if (w.baseInCruiseGap)
        warn('Base en el intervalo de crucero', 'Base modelada a ' + fmt(w.cloudBaseMslFt) +
            ' ft MSL. Crucero a ' + fmt(w.altitudeFt) +
            ' ft MSL. Sin muestra de cobertura en el nivel de vuelo.', 'CAUTION','cbase');
    if(w.isDay===false)warn('Horario','Horario nocturno en la muestra del modelo.');
    if(w.isDay===null)missing.push('Horario diurno/nocturno');
    if(!w.profile.length)missing.push('Perfil vertical');
    issues.sort((a,b)=>Number(b.severity==='ALERT')-Number(a.severity==='ALERT'));
    return {status:issues.some(x=>x.severity==='ALERT')?'ALERT':issues.length?'CAUTION':'NO ALERTS DETECTED',category:'NOT VERIFIED',issues,alerts:issues.map(x=>x.factor+': '+x.detail),missing:[...new Set(missing)],unset:[...new Set(unset)]};
}
export function summarizeRoute(rows) {
    const valid=rows.filter(s=>s.weather&&s.assessment), failed=rows.length-valid.length;
    const alerts=valid.flatMap(s=>s.assessment.issues.map(issue=>({...issue,point:s})));
    alerts.sort((a,b)=>Number(b.severity==='ALERT')-Number(a.severity==='ALERT')||a.point.nm-b.point.nm);
    return {status:alerts.some(a=>a.severity==='ALERT')?'ALERT':alerts.length?'CAUTION':valid.length?'NO ALERTS DETECTED':'NO DATA', valid:valid.length, failed, alerts, affected:valid.filter(s=>s.assessment.issues.length).length, missing:[...new Set(valid.flatMap(s=>s.assessment.missing))],unset:[...new Set(valid.flatMap(s=>s.assessment.unset))]};
}
const rad=x=>x*Math.PI/180;
const deg=x=>x*180/Math.PI;
export function distanceNm(a,b) {
    const dlat=rad(b.lat-a.lat),dlon=rad(b.lon-a.lon);
    const h=Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlon/2)**2;
    return 2*R*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function bearing(a,b){ const d=rad(b.lon-a.lon),p=rad(a.lat),q=rad(b.lat);return (deg(Math.atan2(Math.sin(d)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(d)))+360)%360; }
function along(a,b,t){
    if(t===0)return {...a};if(t===1)return {...b};
    const p=rad(a.lat),l=rad(a.lon),q=rad(b.lat),m=rad(b.lon),d=distanceNm(a,b)/R;
    if(d<1e-10)return {...a};if(Math.abs(Math.PI-d)<1e-7)throw new Error('Tramo demasiado largo para este prototipo.');
    const s=Math.sin((1-t)*d)/Math.sin(d),u=Math.sin(t*d)/Math.sin(d);
    const x=s*Math.cos(p)*Math.cos(l)+u*Math.cos(q)*Math.cos(m),y=s*Math.cos(p)*Math.sin(l)+u*Math.cos(q)*Math.sin(m),z=s*Math.sin(p)+u*Math.sin(q);
    return {lat:deg(Math.atan2(z,Math.hypot(x,y))),lon:deg(Math.atan2(y,x))};
}
export function sampleRoute(points, spacing=15, maxSamples=24){
    if(!Array.isArray(points)||points.length<2||!points.every(validPoint)||!finite(spacing)||spacing<=0)throw new Error('Agrega al menos dos puntos válidos.');
    const legs=points.slice(1).map((p,i)=>distanceNm(points[i],p));
    if(legs.some(d=>d<0.01))throw new Error('Hay puntos consecutivos duplicados.');
    const n=legs.map(d=>Math.max(1,Math.ceil(d/spacing)));
    if(n.reduce((a,b)=>a+b,1)>maxSamples)throw new Error(`Ruta demasiado larga para ${maxSamples} muestras; divide el vuelo en tramos.`);
    const out=[{...points[0],nm:0,course:bearing(points[0],points[1]),label:points[0].name||'Salida',leg:0}];let total=0;
    for(let i=0;i<legs.length;i++){
        for(let j=1;j<=n[i];j++){
            const p=along(points[i],points[i+1],j/n[i]);
            const next=j===n[i]&&i+2<points.length?points[i+2]:j===n[i]?null:along(points[i],points[i+1],(j+1)/n[i]);
            out.push({...p,leg:i+1,label:j===n[i]?(points[i+1].name||`WP ${i+2}`):`${points[i].name||'WP '+(i+1)} → ${points[i+1].name||'WP '+(i+2)}`,nm:total+legs[i]*j/n[i],course:next?bearing(p,next):bearing(out.at(-1),p)});
        }
        total+=legs[i];
    }
    return out;
}
export async function analyzeRoute(api,points,time,altitudeFt,tas,limits,progress=()=>{},reference='MSL'){
    if(!finite(tas)||tas<=0||!finite(time)||!finite(altitudeFt))throw new Error('Revisa hora, altitud y TAS.');
    const samples=sampleRoute(points);const results=[];
    // Bounded sequential requests; missing sample remains visible, never green.
    for(const p of samples){
        const eta=time+p.nm/tas*HOUR;
        try{const weather=await loadWeather(api,p,eta,altitudeFt,reference);results.push({...p,eta,weather,assessment:assess(weather,limits)});}
        catch(e){results.push({...p,eta,error:e.message});}
        progress(results.length,samples.length);
    }
    return results;
}
export function headwind(wind,course){return wind&&finite(wind.kt)&&finite(wind.dir)&&finite(course)?wind.kt*Math.cos(rad(wind.dir-course)):null;}
