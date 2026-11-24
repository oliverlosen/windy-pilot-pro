<script>
    import { onDestroy } from 'svelte';
    import CloudReport from './CloudReport.svelte';
    import { selectMapPoints } from './mapSelection.mjs';
    import store from '@windy/store';
    import { map } from '@windy/map';
    import { getDetailPointForecastData, getElevation } from '@windy/fetch';
    import { loadWeather, assess, analyzeRoute, validPoint, fmt, cloudPercent, headwind, flightTime, timeFields, summarizeRoute } from './flightWeather.mjs';
    export let tab = 'weather';
    export let timestamp;
    const api = { getDetailPointForecastData, getElevation };
    let lat, lon, altitude, tas, name = '', points = [], pointResult = null, routeResult = [], busy = false, progress = '', error = '';
    let windLimit, gustLimit, aloftLimit, clearanceLimit, cloudBaseLimit, cloudPctLimit=60, rainLimit;
    let day='', clock='', zone='GT', timeInitialized=false, picking=false, marks=[], pointMark=null;
    let reference='MSL', panel, stopSelection;
    const statusClass = status=>status==='ALERT'?'critical':status==='CAUTION'?'alert':'neutral';
    const statusLabel = status=>status==='NO ALERTS DETECTED'?'NO ALERTS · PARTIAL':status;
    const pendingLayers=[['Visibilidad','visibility'],['Turbulencia','turbulence'],['Térmicas','ccl'],['Engelamiento','icing']];
    let line = null, alive = true, pointKey = '', routeKey = '', mapError = '';
    const point = () => ({lat, lon});
    $: limits = { wind:windLimit, gust:gustLimit, aloft:aloftLimit, clearance:clearanceLimit, cloudBase:cloudBaseLimit, cloudPct:cloudPctLimit, rain:rainLimit };
    $: if(!timeInitialized && Number.isFinite(timestamp)){timeInitialized=true;setTime(timestamp);}
    $: departure = flightTime(day,clock,zone);
    $: pKey = JSON.stringify([lat,lon,altitude,reference,departure,limits]);
    $: rKey = JSON.stringify([points,altitude,reference,tas,departure,limits]);
    $: pCurrent = pointResult && pointKey === pKey;
    $: rCurrent = routeResult.length > 0 && routeKey === rKey;
    $: routeSummary = summarizeRoute(routeResult);
    $: unresolvedClouds = routeResult.filter(s=>s.weather && !s.weather.cruiseCloud);
    $: factorCounts = Object.entries(routeSummary.alerts.reduce((out,a)=>({...out,[a.factor]:(out[a.factor]||0)+1}),{}));
    $: picking = tab==='planner' || tab==='assessment';
    $: enableSelection(picking && !busy && (tab==='planner'||tab==='assessment'),panel);
    $: refreshMap(tab,points,rCurrent,routeResult,lat,lon,pCurrent,pointResult);
    $: total = routeResult.at(-1)?.nm || 1;
    $: top = Math.ceil((1500+Math.max(0,...routeResult.map(s=>Math.max(s.weather?.altitudeFt??0,s.weather?.terrainFt??0))))/1000)*1000;
    const validAltitude = a => Number.isFinite(a) && a>=0 && a<=45000;
    const validTas = a => Number.isFinite(a) && a>0 && a<=500;
    const validLimits = l=>Object.entries(l).every(([k,v])=>v===undefined||v===null||Number.isFinite(v)&&v>=0&&(k!=='cloudPct'||v<=100));
    const date = t=>Number.isFinite(t)?new Date(t).toISOString().replace('T',' ').slice(0,16)+' Z':'—';
    const gtDate=t=>{const v=timeFields(t,'GT');return v.day?v.day+' '+v.clock+' GT':'—';};
    function setTime(t,z=zone){const v=timeFields(t,z);day=v.day;clock=v.clock;}
    function changeZone(next){const t=flightTime(day,clock,zone);zone=next;if(Number.isFinite(t))setTime(t,next);}
    function now(){setTime(Date.now());}
    function syncWindy(){if(Number.isFinite(timestamp))setTime(timestamp);}
    function toMapTime(){if(Number.isFinite(departure)){try{store.set('timestamp',departure);}catch(e){error='No se pudo cambiar la hora del mapa.';}}}
    function locate(p){try{map.setView({lat:p.lat,lng:p.lon},Math.max(8,map.getZoom()));}catch(e){mapError='No se pudo centrar el mapa.';}}
    function inspectLayer(id,p,t){try{if(p&&validPoint(p))locate(p);if(Number.isFinite(t))store.set('timestamp',t);store.set('overlay',id);if(store.get('overlay')!==id)error='La capa no está disponible en Windy.';}catch(e){error='No se pudo activar la capa.';}}
    function pickOnMap(p){
        lat=p.lat;lon=p.lon;error='';
        if(tab==='planner')addPoint();else picking=false;
    }
    function enableSelection(enabled,element){
        stopSelection?.();
        stopSelection=null;
        if(!enabled || !element)return;
        try{
            stopSelection=selectMapPoints(map,pickOnMap,msg=>error=msg,()=>element.getClientRects().length>0);
        }catch{
            error='El mapa aún no está disponible. Reactiva la selección o usa el centro.';
        }
    }
    const xy = (s,t) => 40+s.nm/t*278;
    const y = (ft,h) => 175-ft/h*155;
    const row = (v,unit,d=0) => v===null||v===undefined||!Number.isFinite(v)?'No disponible':`${fmt(v,d)} ${unit}`;
    function useCenter(add=false){
        try {const c=map.getCenter();lat=Number(c.lat.toFixed(5));lon=Number(c.lng.toFixed(5));error='';if(add)addPoint();}
        catch(e){error='No se pudo leer el centro del mapa. Escribe las coordenadas.';}
    }
    function removeLayer(layer){if(layer){try{map.removeLayer(layer);}catch(e){try{layer.remove();}catch(_){}}}}
    function removeLine(){removeLayer(line);line=null;marks.forEach(removeLayer);marks=[];removeLayer(pointMark);pointMark=null;}
    function refreshMap(currentTab,wp,current,rows,selectedLat,selectedLon,pointCurrent,pointData){
        removeLine();mapError='';
        try{
            if(currentTab==='assessment'&&validPoint({lat:selectedLat,lon:selectedLon})){
                pointMark=L.circleMarker([selectedLat,selectedLon],{radius:7,color:'#edf4fb',weight:2,fillColor:'#60b9ff',fillOpacity:.95,interactive:false}).addTo(map);
            }
            if(currentTab!=='planner')return;
            if(wp.length>1)line=L.polyline(wp.map(p=>[p.lat,p.lon]),{color:'#58b8ff',weight:3,opacity:.9,interactive:false}).addTo(map);
            wp.forEach((p,i)=>{const m=L.circleMarker([p.lat,p.lon],{radius:6,color:'#edf4fb',weight:2,fillColor:'#58b8ff',fillOpacity:1,interactive:false}).addTo(map);marks.push(m);});
            if(current)rows.forEach((p,i)=>{
                const st=p.assessment?.status||'NO DATA';const color=st==='ALERT'?'#f87171':st==='CAUTION'?'#fbbf24':'#a5b6c7';
                const m=L.circleMarker([p.lat,p.lon],{radius:st==='ALERT'||st==='CAUTION'?7:4,color:'#102032',weight:1,fillColor:color,fillOpacity:1,interactive:false}).addTo(map);marks.push(m);
            });
        }catch(e){mapError='No se pudieron mostrar todos los marcadores. Los resultados siguen disponibles.';}
    }
    function addPoint(){if(!validPoint(point())){error='Escribe coordenadas válidas o usa el centro del mapa.';return;}if(points.length>=12){error='Máximo 12 waypoints.';picking=false;return;}if(points.length&&points.at(-1).lat===lat&&points.at(-1).lon===lon){error='El punto ya está al final de la ruta.';return;}points=[...points,{...point(),name:name.trim()||`WP ${points.length+1}`}];name='';error='';}
    function removePoint(i){points=points.filter((_,j)=>i!==j);}
    function reverse(){points=[...points].reverse();}
    function clearRoute(){points=[];routeResult=[];picking=false;}
    async function runPoint(){
        if(!validLimits(limits)){error='Revisa los límites personales en Settings.';return;}
        if(!validPoint(point())||!validAltitude(altitude)||!Number.isFinite(departure)){error='Selecciona coordenadas, altura de crucero y hora válidas.';return;}
        const key=pKey,p={...point()},t=departure,a=altitude,l={...limits};
        busy=true;picking=false;error='';progress='Consultando ECMWF…';pointResult=null;
        try{const w=await loadWeather(api,p,t,a,reference);if(alive){pointResult={weather:w,assessment:assess(w,l)};pointKey=key;}}
        catch(e){if(alive)error=e.message||'Error de pronóstico';}
        finally{if(alive){busy=false;progress='';}}
    }
    async function runRoute(){
        if(!validLimits(limits)){error='Revisa los límites personales en Settings.';return;}
        if(points.length<2||!validAltitude(altitude)||!validTas(tas)||!Number.isFinite(departure)){error='Agrega dos waypoints como mínimo, altura de crucero, TAS y hora.';return;}
        const key=rKey,p=points.map(x=>({...x})),t=departure,a=altitude,v=tas,l={...limits};
        busy=true;picking=false;error='';progress='Preparando muestras…';routeResult=[];
        try{const result=await analyzeRoute(api,p,t,a,v,l,(done,n)=>{if(alive)progress=`Consultando ${done}/${n} puntos`;},reference);if(alive){routeResult=result;routeKey=key;}}
        catch(e){if(alive)error=e.message||'Error de ruta';}
        finally{if(alive){busy=false;progress='';}}
    }
    onDestroy(()=>{alive=false;stopSelection?.();removeLine();});
</script>

{#if tab !== 'weather'}
<div class="ft" bind:this={panel}>
    {#if tab === 'settings'}
        <h2>Personal limits</h2><p>Opcionales. Configura tus propios límites tras comprobar el POH, procedimientos y normativa. En blanco, no se evalúa ese umbral. No son límites del fabricante.</p>
        <div class="two">
            <label>Viento superficie (kt)<input type="number" min="0" max="150" bind:value={windLimit} disabled={busy} placeholder="Sin configurar"/></label>
            <label>Ráfagas (kt)<input type="number" min="0" max="150" bind:value={gustLimit} disabled={busy} placeholder="Sin configurar"/></label>
            <label>Viento en altitud (kt)<input type="number" min="0" max="150" bind:value={aloftLimit} disabled={busy} placeholder="Sin configurar"/></label>
            <label>Separación de terreno (ft)<input type="number" min="0" max="20000" bind:value={clearanceLimit} disabled={busy} placeholder="Sin configurar"/></label>
        </div><div class="two">
            <label>Base nubosa modelo mín. (ft AGL)<input type="number" min="0" max="20000" bind:value={cloudBaseLimit} disabled={busy} placeholder="Sin configurar"/></label>
            <label>Nube cerca de crucero (%)<input type="number" min="0" max="100" bind:value={cloudPctLimit} disabled={busy} placeholder="Sin configurar"/></label>
            <label>Lluvia máx. (mm/intervalo)<input type="number" min="0" bind:value={rainLimit} disabled={busy} placeholder="Sin configurar"/></label>
        </div><p>60% es un umbral inicial de revisión de nubosidad modelada, no un mínimo VFR. Modifícalo o déjalo en blanco.</p><p>Los valores son de la sesión y no se guardan todavía. Los cambios invalidan cualquier análisis anterior.</p>
    {:else}
        <h2>{tab==='assessment'?'Flight Assessment':'Flight Planner'}</h2>
        <div class="section-box">
            <div class="section-title">{tab==='planner'?'FECHA Y HORA DE SALIDA':'FECHA Y HORA DEL ANÁLISIS'}</div>
            <div class="two"><label>Día<input type="date" bind:value={day} disabled={busy}/></label><label>Hora<input type="time" bind:value={clock} disabled={busy}/></label></div>
            <div class="two"><button type="button" class:chosen={zone==='GT'} on:click={()=>changeZone('GT')} disabled={busy}>Guatemala (UTC−6)</button><button type="button" class:chosen={zone==='UTC'} on:click={()=>changeZone('UTC')} disabled={busy}>UTC / Zulu</button></div>
            <div class="time-summary">{gtDate(departure)} · {date(departure)}</div>
            <div class="two"><button type="button" disabled={busy} on:click={now}>Ahora</button><button type="button" disabled={busy} on:click={syncWindy}>Tomar hora de Windy</button></div>
            <button type="button" class="wide" disabled={busy||!Number.isFinite(departure)} on:click={toMapTime}>Mostrar esta hora en el mapa</button>
            <small>ECMWF · Hasta 7 días solicitados. Se usa el dato disponible más próximo (máx. ±30 min); la hora elegida no cambia al mover la línea de tiempo.</small>
        </div>
        <div class="two">
            <label>Referencia vertical<select bind:value={reference} disabled={busy}><option value="MSL">MSL · sobre el mar</option><option value="AGL">AGL · sobre el terreno</option></select></label>
            <label>Crucero (ft {reference})<input type="number" min="0" max="45000" step="1" bind:value={altitude} placeholder={reference==='AGL'?'Ej. 1000':'Ej. 6500'} disabled={busy}/></label>
            {#if tab==='planner'}<label>TAS (kt)<input type="number" min="1" max="500" bind:value={tas} placeholder="Ej. 110" disabled={busy}/></label>{:else}<label>Modelo<input value="ECMWF" disabled/></label>{/if}
            <label>Latitud<input type="number" step="0.00001" min="-90" max="90" bind:value={lat} disabled={busy}/></label>
            <label>Longitud<input type="number" step="0.00001" min="-180" max="180" bind:value={lon} disabled={busy}/></label>
        </div>
        {#if reference==='AGL'}<p>La altura elegida se suma al terreno de cada punto para calcular el crucero MSL.</p>{/if}
        <div class="section-title">{tab==='planner'?'AGREGAR WAYPOINTS':'ELEGIR UBICACIÓN'}</div>
        <div class="two"><button type="button" class:chosen={picking} disabled={busy} on:click={()=>picking=!picking}>{picking?'Terminar selección':'＋ Seleccionar en mapa'}</button><button type="button" disabled={busy} on:click={()=>useCenter(tab==='planner')}>{tab==='planner'?'⌖ Agregar centro':'⌖ Usar centro'}</button></div>
        {#if picking}<div class="notice select-note">{tab==='planner'?'Haz clic en el mapa para agregar cada waypoint. Pulsa Terminar selección al acabar.':'Haz clic en el mapa para elegir el punto de análisis.'}</div>{/if}
        <small>También puedes mover el mapa y usar su centro.</small>
        {#if tab==='planner'}
            <div class="add"><label>Nombre del waypoint<input type="text" bind:value={name} maxlength="40" placeholder="MGGT / WP 1" disabled={busy}/></label><button type="button" on:click={addPoint} disabled={busy}>+ Agregar</button></div>
            {#each points as p,i}<div class="wp"><div><strong>{i+1}. {p.name}</strong><small>{fmt(p.lat,4)}, {fmt(p.lon,4)}</small></div><button type="button" on:click={()=>removePoint(i)} disabled={busy} aria-label={'Eliminar '+p.name}>×</button></div>{/each}
            {#if points.length}<div class="two"><button type="button" on:click={reverse} disabled={busy}>Invertir</button><button type="button" on:click={clearRoute} disabled={busy}>Limpiar ruta</button></div>{/if}
            {#if mapError}<p role="status">{mapError}</p>{/if}
            <button type="button" class="wide primary" on:click={runRoute} disabled={busy||points.length<2}>Analizar ruta</button>
            <p>Muestras aproximadamente cada 15 NM (máximo 24), no cubren todos los obstáculos ni la ruta entre puntos. ETA estimada en aire en calma, sin ascenso, descenso ni corrección de viento.</p>
        {:else}
            <button type="button" class="wide primary" on:click={runPoint} disabled={busy}>Analizar meteorología</button>
        {/if}
        {#if busy}<div class="notice" role="status">{progress}</div>{/if}
        {#if error}<div class="notice alert" role="alert">{error}</div>{/if}
        {#if tab==='assessment' && mapError}<p role="status">{mapError}</p>{/if}
        {#if tab==='assessment' && pointResult}
            {#if !pCurrent}<div class="notice">El análisis anterior ya no corresponde a tus parámetros. Vuelve a analizar.</div>
            {:else}
                <div class="notice result {statusClass(pointResult.assessment.status)}"><small>POINT ASSESSMENT · ECMWF</small><strong>{statusLabel(pointResult.assessment.status)}</strong><small>{pointResult.assessment.issues.length} alertas · {pointResult.assessment.missing.length} verificaciones pendientes</small></div>
                <CloudReport weather={pointResult.weather}/>
                {#each pointResult.assessment.issues as a}<div class="issue {statusClass(a.severity)}"><strong>{a.factor}</strong><div>{a.detail}</div>{#if a.overlay}<button type="button" on:click={()=>inspectLayer(a.overlay,point(),departure)}>Ver capa ↗</button>{/if}</div>{:else}<p>No se detectaron alertas en las reglas y datos evaluados. Esto no indica condiciones seguras.</p>{/each}
                <div class="section-title">PENDIENTE DE VERIFICAR</div>
                <div class="two">{#each pendingLayers as l}<button type="button" on:click={()=>inspectLayer(l[1],point(),departure)}>{l[0]} ↗</button>{/each}</div><p>Estas capas se abren para revisión manual; no se han medido automáticamente.</p>
                <details><summary>Datos faltantes y límites sin configurar</summary><p>{pointResult.assessment.missing.join(' · ')}</p>{#if pointResult.assessment.unset.length}<p>Sin límite personal: {pointResult.assessment.unset.join(' · ')}</p>{/if}</details>
                <p>Hora de datos: {date(pointResult.weather.time)} · Modelo actualizado: {pointResult.weather.update||'—'}</p>
                {#each [ ['Viento superficie',row(pointResult.weather.surfaceWindKt,'kt',1)],['Dirección',row(pointResult.weather.surfaceDir,'°')],['Ráfagas superficie',row(pointResult.weather.gustKt,'kt',1)],['Viento en crucero',pointResult.weather.wind?row(pointResult.weather.wind.kt,'kt',1)+' / '+row(pointResult.weather.wind.dir,'°'):'Sin niveles válidos'],['Elevación muestreada',row(pointResult.weather.terrainFt,'ft MSL')],['Elevación del modelo',row(pointResult.weather.modelTerrainFt,'ft MSL')],['Separación del terreno',row(pointResult.weather.clearanceFt,'ft')],['Lluvia (acumulado del paso)',row(pointResult.weather.rainMm,'mm',2)],['Precipitación convectiva',row(pointResult.weather.convectiveMm,'mm',2)],['Temperatura superficie',row(pointResult.weather.temperatureC,'°C',1)],['Punto de rocío',row(pointResult.weather.dewPointC,'°C',1)] ] as item}
                    <div class="metric"><span>{item[0]}</span><strong>{item[1]}</strong></div>
                {/each}
                <h3>Perfil vertical del punto</h3>
                <div class="scroll"><table><thead><tr><th>Nivel</th><th>ft MSL</th><th>ft AGL¹</th><th>Nubes</th><th>kt / °</th></tr></thead><tbody>
                    <tr><th>Terreno</th><td>{fmt(pointResult.weather.terrainFt)}</td><td>{pointResult.weather.terrainFt===null?'—':'0'}</td><td>—</td><td>—</td></tr>
                    {#each pointResult.weather.profile as p}<tr><td>{p.id==='surface'?'Superficie del modelo':p.id.replace('h',' hPa')}</td><td>{fmt(p.heightFt)}</td><td>{fmt(p.aglFt)}</td><td>{cloudPercent(p.cloudPct)}</td><td>{fmt(p.windKt,1)} / {fmt(p.windDir)}</td></tr>{/each}
                </tbody></table></div><small>¹ Altura sobre el terreno del punto. Cada porcentaje corresponde a un nivel muestreado.</small>

            {/if}
        {/if}
        {#if tab==='planner'&&routeResult.length}
            {#if !rCurrent}<div class="notice">La ruta o sus parámetros cambiaron. Vuelve a analizar.</div>
            {:else}
                <div class="notice result {statusClass(routeSummary.status)}"><small>ROUTE ASSESSMENT · ECMWF</small><strong>{statusLabel(routeSummary.status)}</strong><small>{routeSummary.affected} puntos con alertas · {routeSummary.valid}/{routeResult.length} muestras con pronóstico</small><small>{routeSummary.missing.length} factores pendientes · {routeSummary.unset.length} límites sin configurar</small></div>
                {#if unresolvedClouds.length}
                    <details><summary>Cobertura de nubes sin resolver en {unresolvedClouds.length} de {routeResult.length} puntos</summary>
                        {#each unresolvedClouds as s}<div class="metric"><span>{s.label} · {fmt(s.nm,1)} NM<small>{gtDate(s.eta)}</small></span><button type="button" on:click={()=>inspectLayer('clouds',s,s.eta)}>Ver en mapa</button></div>{/each}
                    </details>
                {/if}
                <div class="section-title">ALERTAS EN RUTA</div>
                {#if factorCounts.length}<div class="factor-list">{#each factorCounts as f}<span>{f[0]} · {f[1]}</span>{/each}</div>{/if}
                <div class="route-alerts">{#each routeSummary.alerts as a}
                    <div class="issue {statusClass(a.severity)}"><div class="issue-head"><strong>{a.factor}</strong><small>{fmt(a.point.nm,1)} NM</small></div><div>{a.detail}</div><small>{a.point.label} · {gtDate(a.point.eta)} · {fmt(a.point.lat,4)}, {fmt(a.point.lon,4)}</small><div class="two"><button type="button" on:click={()=>locate(a.point)}>Ver punto ↗</button>{#if a.overlay}<button type="button" on:click={()=>inspectLayer(a.overlay,a.point,a.point.eta)}>Ver capa ↗</button>{/if}</div></div>
                {:else}<p>{routeSummary.valid?'Sin alertas detectadas en las reglas y muestras evaluadas. No es una autorización de vuelo.':'No se obtuvo pronóstico para la ruta.'}</p>{/each}</div>
                {#if routeSummary.failed}<div class="notice alert"><strong>{routeSummary.failed} muestras sin datos</strong>{#each routeResult.filter(s=>!s.weather) as s}<div class="metric"><span>{s.label} · {fmt(s.nm,1)} NM<br/>{gtDate(s.eta)}<small>{s.error}</small></span><button type="button" on:click={()=>locate(s)}>Mapa ↗</button></div>{/each}</div>{/if}
                <details><summary>Verificaciones pendientes / límites sin configurar</summary><p>{routeSummary.missing.join(' · ')||'Sin datos para evaluar.'}</p>{#if routeSummary.unset.length}<p>Sin límite personal: {routeSummary.unset.join(' · ')}</p>{/if}<p>Para ver una capa pendiente en un punto, abre su detalle debajo.</p></details>
                <h3>Perfil vertical muestreado</h3><p>{fmt(total,1)} NM · {fmt(total/tas*60)} min sin viento · {routeResult.filter(s=>s.weather).length}/{routeResult.length} puntos con pronóstico.</p>
                <svg viewBox="0 0 330 200" role="img" aria-label="Perfil de terreno, niveles de nubosidad y altura de crucero">
                    <rect x="40" y="20" width="278" height="155" rx="3" fill="#0c1827"/>
                    {#each [0,1,2,3,4] as i}<line x1="40" x2="318" y1={y(top*i/4,top)} y2={y(top*i/4,top)} stroke="#33485e" stroke-dasharray="3 3"/><text x="36" y={y(top*i/4,top)+3} text-anchor="end" fill="#b6c9d8" font-size="8">{fmt(top*i/4)}</text>{/each}
                    {#each routeResult as s,i}
                        {#if s.weather}
                            {#each s.weather.profile.filter(p=>p.heightFt<=top&&p.cloudPct!==null&&p.cloudPct>0) as p}<rect x={xy(s,total)-3} y={y(p.heightFt,top)-3} width="6" height="6" rx="1" fill="#e6edf5" opacity={.15+.85*p.cloudPct/100}/>{/each}
                            {#if Number.isFinite(s.weather.cloudBaseMslFt) && s.weather.cloudBaseMslFt<=top}<line x1={xy(s,total)-4} x2={xy(s,total)+4} y1={y(s.weather.cloudBaseMslFt,top)} y2={y(s.weather.cloudBaseMslFt,top)} stroke="#c4a6ff" stroke-width="2"/>{/if}
                            {#if s.weather.terrainFt!==null&&s.weather.terrainFt>=0}<line x1={xy(s,total)} x2={xy(s,total)} y1="175" y2={y(s.weather.terrainFt,top)} stroke="#66825c" stroke-width="4"/>{/if}
                        {/if}
                        {#if Number.isFinite(s.weather?.altitudeFt)}
                            {#if i>0 && Number.isFinite(routeResult[i-1].weather?.altitudeFt)}
                                <line x1={xy(routeResult[i-1],total)} x2={xy(s,total)} y1={y(routeResult[i-1].weather.altitudeFt,top)} y2={y(s.weather.altitudeFt,top)} stroke="#60b9ff" stroke-dasharray="4 3"/>
                            {/if}
                            <circle cx={xy(s,total)} cy={y(s.weather.altitudeFt,top)} r="3" fill={s.assessment?.status==='ALERT'?'#f87171':s.assessment?.status==='CAUTION'?'#fbbf24':'#9caec0'}/>
                        {/if}
                    {/each}
                    <text x="40" y="188" fill="#b6c9d8" font-size="9">0 NM</text><text x="318" y="188" text-anchor="end" fill="#b6c9d8" font-size="9">{fmt(total,1)} NM</text>
                </svg>
                <p>Eje vertical en ft MSL. Verde: terreno. Blanco: cobertura por nivel. Violeta: base modelada. Azul: crucero entre muestras. Rojo: alerta de terreno; amarillo: alerta de revisión; gris: sin alerta detectada o sin datos (consulta el detalle). No muestra ascenso ni descenso.</p>
                {#each routeResult as s,i}
                    <details><summary>{fmt(s.nm,1)} NM · {s.label} · {s.assessment?.status==='NO ALERTS DETECTED'?'REVIEW':s.assessment?.status||'NO DATA'}</summary><p>{gtDate(s.eta)} · {date(s.eta)} · {fmt(s.lat,4)}, {fmt(s.lon,4)}</p><button type="button" class="wide" on:click={()=>locate(s)}>Ver punto en mapa ↗</button><div class="two">{#each pendingLayers as l}<button type="button" on:click={()=>inspectLayer(l[1],s,s.eta)}>{l[0]} ↗</button>{/each}</div>
                    {#if s.weather}<CloudReport weather={s.weather}/><div class="metric"><span>Terreno muestreado</span><strong>{row(s.weather.terrainFt,'ft MSL')}</strong></div><div class="metric"><span>Viento crucero</span><strong>{row(s.weather.wind?.kt,'kt',1)} / {row(s.weather.wind?.dir,'°')}</strong></div><div class="metric"><span>Componente de frente (+)</span><strong>{row(headwind(s.weather.wind,s.course),'kt',1)}</strong></div><div class="metric"><span>Ráfagas superficie</span><strong>{row(s.weather.gustKt,'kt',1)}</strong></div><div class="metric"><span>Precipitación</span><strong>{row(s.weather.rainMm,'mm',2)}</strong></div><div class="metric"><span>Hora pronóstico</span><strong>{date(s.weather.time)}</strong></div>{#each s.assessment.alerts as a}<p class="alert-text">• {a}</p>{/each}<p>Visibilidad, turbulencia, térmicas, hielo y observaciones no verificados.</p>{:else}<p>{s.error||'No disponible'}</p>{/if}</details>
                {/each}
            {/if}
        {/if}
    {/if}
    <p class="foot">Experimental · No sustituye briefing oficial, METAR/TAF, SIGMET, cartas, POH ni revisión de terreno y obstáculos. Nunca autoriza un vuelo.</p>
</div>
{/if}

<style>
    .ft select{display:block;width:100%;margin-top:4px;min-height:38px;background:#0e1b2a;border:1px solid #3a526a;border-radius:7px;color:#edf4fb;padding:7px;font:inherit}
    .ft{font:12px/1.45 system-ui,sans-serif;color:#edf4fb;min-width:0}.ft *{box-sizing:border-box}.ft h2{font-size:18px;margin:8px 0}.ft h3{font-size:13px;margin:12px 0 5px}.ft p{color:#b6c9d8;margin:6px 0 10px;font-size:11px}.ft label{display:block;font-size:10px;color:#b6c9d8;min-width:0}.ft input{display:block;width:100%;min-width:0;background:#0e1b2a;border:1px solid #3a526a;border-radius:7px;color:#edf4fb;font:inherit;padding:9px;margin:4px 0 2px}.ft button{background:#22394f;color:#e6f1fa;border:1px solid #3b5773;border-radius:7px;padding:7px;font:inherit;cursor:pointer;min-height:38px}.ft button:disabled{opacity:.55;cursor:default}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0}.wide{display:block;width:100%;margin:8px 0}.ft .primary{background:#215782;border-color:#5799c9;font-weight:700}.add{display:grid;grid-template-columns:1fr auto;align-items:end;gap:6px;margin:6px 0}.wp,.metric{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #304459}.metric strong{text-align:right;font-size:11px}.ft small{display:block;font-size:10px;color:#b6c9d8}.wp button{min-height:28px;width:30px}.notice{background:#26394d;border:1px solid #4c6883;border-radius:9px;padding:9px;margin:9px 0}.notice strong{display:block;font-size:19px}.alert{color:#ffdfa2;background:#382e23;border-color:#c09255}.ft .alert-text{color:#ffdfa2}.scroll{max-height:190px;overflow:auto}.ft table{width:100%;text-align:right;border-collapse:collapse;font-size:11px}.ft th,.ft td{padding:5px;border-bottom:1px solid #34495f}.ft th{color:#b6c9d8}.ft svg{width:100%;display:block;margin:6px 0}.ft details{border:1px solid #33485e;border-radius:7px;padding:6px;margin:5px 0}.ft summary{cursor:pointer;overflow-wrap:anywhere}.ft .foot{border-top:1px solid #33485e;padding-top:9px;margin-top:12px;font-size:10px}

    .section-box{padding:10px;background:#18283a;border:1px solid #33485e;border-radius:10px;margin:8px 0 12px}.section-title{font-size:10px;font-weight:750;letter-spacing:.08em;color:#b6c9d8;margin:9px 0 5px}.ft .chosen{background:#225780;border-color:#7cc8ff}.time-summary{font-size:11px;font-variant-numeric:tabular-nums;color:#d5e6f5;padding:4px 0}.ft input[type="date"],.ft input[type="time"]{color-scheme:dark;min-height:39px}.result{padding:12px}.result strong{font-size:17px;line-height:1.15;margin:4px 0}.neutral{background:#25394d;border-color:#536c84;color:#dce7f3}.critical{background:#492a30;border-color:#da7279;color:#ffb5b5}.issue{border:1px solid #a48153;border-radius:8px;padding:9px;margin:6px 0;font-size:11px}.issue.critical{border-color:#da7279}.issue strong{font-size:13px}.issue small{margin:4px 0;color:#e0d6c6}.issue-head{display:flex;align-items:center;justify-content:space-between;gap:6px}.issue button{min-height:30px;padding:5px 7px;margin-top:4px}.select-note{border-color:#7cc8ff}.ft .time-summary{overflow-wrap:anywhere}
.route-alerts{max-height:360px;overflow-y:auto;overscroll-behavior:contain}.factor-list{display:flex;gap:5px;flex-wrap:wrap;margin:5px 0}.factor-list span{border:1px solid #a48153;border-radius:5px;background:#382e23;color:#ffdfa2;padding:4px 6px;font-size:10px}</style>
