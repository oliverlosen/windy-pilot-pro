<script>
    import { onMount } from 'svelte';
    import store from '@windy/store';
    import bcast from '@windy/broadcast';
    import { map } from '@windy/map';
    import config from './pluginConfig';
    import FlightTools from './FlightTools.svelte';
    let tab = 'weather';
    import { GROUPS, LAYERS, KEYS, readState, allowedLayer, optionsWithCurrent, levelLabel, productLabel, layerLabel, selectValue, formatTime } from './pilot.mjs';

    let state = readState(store);
    let message = '';
    let error = false;
    let showHelp = false;
    let collapsed = {};
    $: active = LAYERS.find(item => item.id === state.overlay);
    $: levels = optionsWithCurrent(state.levels, state.level);
    $: models = optionsWithCurrent(state.products, state.product);
    $: index = LAYERS.findIndex(item => item.id === state.overlay);
    $: hasMultipleLevels = state.levels.length > 1;

    function sync() { state = readState(store); }
    onMount(() => {
        KEYS.forEach(key => store.on(key, sync));
        sync();
        return () => KEYS.forEach(key => store.off(key, sync));
    });

    function choose(key, value) {
        const result = selectValue(store, key, value);
        error = !result.ok;
        message = result.ok ? '' : result.reason;
        sync();
        return result.ok;
    }
    function changeSelect(key, event) {
        choose(key, event.currentTarget.value);
        event.currentTarget.value = store.get(key) ?? '';
    }
    function step(direction) {
        const available = LAYERS.filter(item => allowedLayer(state, item.id));
        if (!available.length) return;
        const at = available.findIndex(item => item.id === state.overlay);
        const next = at < 0 ? (direction > 0 ? 0 : available.length - 1) : (at + direction + available.length) % available.length;
        choose('overlay', available[next].id);
    }
    function centerGuatemala() {
        try {
            map.setView({ lat: 15.45, lng: -90.30 }, 7);
            message = ''; error = false;
        } catch (e) { message = 'No se pudo centrar el mapa.'; error = true; }
    }
    function toggleGroup(title) { collapsed = { ...collapsed, [title]: !collapsed[title] }; }
</script>

<div class="plugin__mobile-header">{config.title}</div>
<section class="plugin__content">
    <div class="pilot-shell">
        <header class="masthead">
            <div class="brandline">
                <button type="button" class="back" aria-label="Volver al menú de Windy" on:click={() => bcast.emit('rqstOpen', 'menu')}>‹</button>
                <div class="mark" aria-hidden="true">PP</div>
                <div class="brand"><span class="eyebrow">AVIATION WEATHER</span><h1>Pilot Pro</h1></div>
                <span class="version">v{config.version}</span>
            </div>
            <p class="subline">Pre-flight weather · Windy native</p>
        </header>

        <nav class="pilot-tabs" aria-label="Pilot Pro sections">
            {#each [['weather','Weather'],['assessment','Assessment'],['planner','Planner'],['settings','Settings']] as item}
                <button type="button" class:tab-selected={tab===item[0]} aria-pressed={tab===item[0]} on:click={()=>tab=item[0]}>{item[1]}</button>
            {/each}
        </nav>
        <FlightTools {tab} timestamp={state.timestamp}/>
        {#if tab==='weather'}
        <div class="current">
            <div class="current-top"><span class="eyebrow">ACTIVE LAYER</span><span class="model-chip">{productLabel(state.product)}</span></div>
            <div class="current-name"><span class="symbol" aria-hidden="true">{active?.icon ?? '◉'}</span><strong>{layerLabel(state.overlay)}</strong></div>
            <p class="layer-info">{active?.info ?? 'Capa seleccionada desde los controles de Windy.'}</p>
            <div class="switcher">
                <button type="button" on:click={() => step(-1)} aria-label="Capa anterior">‹ Anterior</button>
                <span>{index < 0 ? '—' : `${index + 1} / ${LAYERS.length}`}</span>
                <button type="button" on:click={() => step(1)} aria-label="Siguiente capa">Siguiente ›</button>
            </div>
        </div>

        <div class="control-panel">
            <label for="pp-altitude">ALTITUDE / PRESSURE LEVEL</label>
            <select id="pp-altitude" value={state.level} disabled={!hasMultipleLevels} on:change={event => changeSelect('level', event)}>
                {#if !levels.length}<option value="">No disponible</option>{/if}
                {#each levels as level}<option value={level} disabled={!state.levels.includes(level)}>{levelLabel(level)}</option>{/each}
            </select>
            <p class="hint">{hasMultipleLevels ? 'Pies ISA aproximados; no son altitud real MSL ni AGL.' : 'Esta capa no permite seleccionar otros niveles.'}</p>
            {#if hasMultipleLevels}
                <div class="level-quick" aria-label="Accesos rápidos de nivel">
                    {#each ['surface', '900h', '850h', '800h', '700h'] as level}
                        {#if state.levels.includes(level)}
                            <button type="button" class:active-level={state.level === level} aria-pressed={state.level === level} on:click={() => choose('level', level)}>{level === 'surface' ? 'SFC' : levelLabel(level).split(' · ')[0]}</button>
                        {/if}
                    {/each}
                </div>
            {/if}
            <label for="pp-model">FORECAST MODEL / SOURCE</label>
            <select id="pp-model" value={state.product} disabled={state.products.length < 2} on:change={event => changeSelect('product', event)}>
                {#if !models.length}<option value="">No disponible</option>{/if}
                {#each models as model}<option value={model} disabled={!state.products.includes(model)}>{productLabel(model)}</option>{/each}
            </select>
            <div class="time-row">
                <div><span class="eyebrow">HORA LOCAL</span><strong>{formatTime(state.timestamp)}</strong></div>
                <div><span class="eyebrow">UTC / ZULU</span><strong>{formatTime(state.timestamp, true)} Z</strong></div>
            </div>
            <p class="hint">Hora seleccionada: cambia el pronóstico con la línea de tiempo original de Windy. No es una confirmación de carga del mapa.</p>
        </div>

        {#if message}<div class="message" class:error role="status" aria-live="polite">{message}<button type="button" aria-label="Cerrar mensaje" on:click={() => message = ''}>×</button></div>{/if}

        {#each GROUPS as group (group.title)}
            <section class="layer-group">
                <button type="button" class="group-title" aria-expanded={!collapsed[group.title]} on:click={() => toggleGroup(group.title)}><span>{group.title}</span><span>{collapsed[group.title] ? '+' : '−'}</span></button>
                {#if !collapsed[group.title]}
                    <div class="layer-grid">
                        {#each group.layers as layer (layer.id)}
                            <button type="button" class="layer" class:selected={state.overlay === layer.id} disabled={!allowedLayer(state, layer.id)} aria-pressed={state.overlay === layer.id} on:click={() => choose('overlay', layer.id)}>
                                <span class="layer-icon" aria-hidden="true">{layer.icon}</span><span>{layer.label}</span><span class="dot" aria-hidden="true"></span>
                            </button>
                        {/each}
                    </div>
                {/if}
            </section>
        {/each}

        <section class="tools">
            <span class="eyebrow">MAP TOOLS</span>
            <div class="tool-grid">
                <button type="button" class="tool" aria-pressed={state.particles !== 'off'} on:click={() => choose('particlesAnim', state.particles === 'off' ? 'on' : 'off')}>↝ Particles <strong>{state.particles === 'off' ? 'OFF' : 'ON'}</strong></button>
                <button type="button" class="tool" on:click={centerGuatemala}>⌖ Guatemala</button>
            </div>
            <button type="button" class="help" aria-expanded={showHelp} on:click={() => showHelp = !showHelp}>{showHelp ? '−' : '+'} Cómo interpretar este panel</button>
            {#if showHelp}
                <div class="help-body">
                    <p>El panel selecciona una capa principal a la vez y mantiene la leyenda, los datos y el mapa nativos de Windy. Si cambias la capa o el modelo, los niveles disponibles pueden cambiar.</p>
                    <p>Los niveles de presión se muestran con una equivalencia ISA aproximada. Pueden quedar por debajo del terreno montañoso. Surface no equivale a cero pies MSL.</p>
                    <p>Consulta los METAR, TAF, SIGMET, AIP/NOTAM y el briefing meteorológico oficial. El modelo no resuelve todos los efectos locales ni acredita condiciones VFR.</p>
                </div>
            {/if}
        </section>
        <footer>FORECAST AID ONLY · No sustituye briefing oficial, observaciones ni criterio operacional. Verifica la leyenda y hora en Windy.</footer>
        {/if}
    </div>
</section>

<style lang="less">
    .pilot-shell { --pp-bg: #101b2b; --pp-card: #18283a; --pp-line: #33485e; --pp-fg: #edf4fb; --pp-muted: #aebed0; --pp-blue: #7cc8ff; box-sizing: border-box; background: var(--pp-bg); color: var(--pp-fg); border: 1px solid var(--pp-line); border-radius: 14px; padding: 13px; font: 13px/1.45 system-ui, sans-serif; width: 100%; text-align: left; }
    .pilot-shell * { box-sizing: border-box; }
    .pilot-tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:4px; margin:0 0 12px; }
    .pilot-shell .pilot-tabs button { min-height:36px; font-size:11px; padding:3px; }
    .pilot-shell .pilot-tabs .tab-selected { background:#214c70; border-color:var(--pp-blue); color:#fff; }
    .pilot-shell button, .pilot-shell select { font: inherit; color: inherit; margin: 0; }
    .pilot-shell button { cursor: pointer; text-transform: none; letter-spacing: normal; background: var(--pp-card); border: 1px solid var(--pp-line); border-radius: 8px; min-height: 38px; padding: 7px; }
    .pilot-shell button:hover:not(:disabled) { border-color: var(--pp-blue); background: #213b54; }
    .pilot-shell button:focus-visible, .pilot-shell select:focus-visible { outline: 2px solid var(--pp-blue); outline-offset: 2px; }
    .pilot-shell button:disabled, .pilot-shell select:disabled { opacity: .57; cursor: default; }
    .masthead { margin-bottom: 14px; }
    .brandline { display: flex; align-items: center; gap: 9px; }
    .back { font-size: 24px !important; width: 27px; padding: 0 !important; min-height: 34px !important; }
    .mark { display: grid; place-items: center; height: 40px; width: 40px; flex: 0 0 40px; border-radius: 11px; background: #185588; border: 1px solid #3879a8; color: #fff; font-weight: 800; letter-spacing: -.5px; font-size: 19px; }
    .brand { min-width: 0; flex: 1; }
    .eyebrow { display: block; font-size: 10px; font-weight: 650; letter-spacing: .09em; color: var(--pp-muted); }
    h1 { font-size: 22px; line-height: 1.1; color: var(--pp-fg); margin: 2px 0 0; font-weight: 750; }
    .version { color: var(--pp-muted); font-size: 10px; white-space: nowrap; }
    .subline { margin: 8px 0 0; color: var(--pp-muted); font-size: 11px; }
    .current { background: #1a344c; border: 1px solid #365c7e; border-radius: 11px; padding: 11px; margin-bottom: 13px; }
    .current-top, .current-name, .switcher { display: flex; align-items: center; gap: 8px; }
    .current-top { justify-content: space-between; }
    .model-chip { color: var(--pp-blue); font-size: 11px; font-weight: 700; overflow-wrap: anywhere; }
    .current-name { margin-top: 6px; font-size: 19px; }
    .symbol { color: var(--pp-blue); font-size: 24px; line-height: 1; }
    .layer-info { color: #d6e3f1; font-size: 11px; margin: 6px 0 10px; min-height: 30px; }
    .switcher { justify-content: space-between; color: var(--pp-muted); font-size: 11px; }
    .switcher button { min-height: 30px; font-size: 11px; padding: 5px 9px; }
    .control-panel { padding: 11px; background: var(--pp-card); border: 1px solid var(--pp-line); border-radius: 11px; margin-bottom: 12px; }
    label { display: block; color: var(--pp-muted); font-size: 10px; letter-spacing: .07em; font-weight: 700; margin: 0 0 6px; }
    select { width: 100%; min-height: 40px; padding: 6px 8px; background: #0f1c2c; color: var(--pp-fg); border: 1px solid var(--pp-line); border-radius: 7px; }
    select option { color: #edf4fb; background: #0f1c2c; }
    .hint { font-size: 10px; color: var(--pp-muted); margin: 6px 0 12px; }
    .hint:last-child { margin-bottom: 0; }
    .level-quick { display: flex; gap: 5px; flex-wrap: wrap; margin: -3px 0 12px; }
    .level-quick button { font-size: 10px; padding: 5px 7px; min-height: 30px; flex: 1 1 auto; }
    .level-quick .active-level { background: #214c70; border-color: var(--pp-blue); color: #e3f4ff; }
    .time-row { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; border-top: 1px solid var(--pp-line); margin-top: 12px; padding-top: 10px; }
    .time-row strong { display: block; margin-top: 3px; font-size: 12px; font-variant-numeric: tabular-nums; }
    .message { border: 1px solid #56748f; background: #263a50; padding: 8px; border-radius: 8px; margin-bottom: 10px; font-size: 11px; display: flex; align-items: center; gap: 6px; justify-content: space-between; }
    .message.error { border-color: #c68b53; color: #ffdfad; }
    .message button { min-height: 25px; padding: 2px 6px; }
    .layer-group { margin: 0 0 11px; }
    .pilot-shell .group-title { display: flex; justify-content: space-between; align-items: center; text-align: left; width: 100%; border: 0; padding: 3px 0 7px; background: transparent; min-height: 25px; color: var(--pp-muted); font-size: 10px; font-weight: 750; letter-spacing: .08em; }
    .layer-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .pilot-shell .layer { display: flex; align-items: center; gap: 6px; min-height: 44px; text-align: left; font-size: 11px; font-weight: 600; padding: 8px; }
    .layer-icon { width: 17px; flex: 0 0 17px; text-align: center; color: var(--pp-blue); font-size: 17px; line-height: 1; }
    .dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; margin-left: auto; background: transparent; }
    .pilot-shell .selected { background: #244968; border-color: var(--pp-blue); }
    .selected .dot { background: var(--pp-blue); }
    .tools { border-top: 1px solid var(--pp-line); padding-top: 12px; }
    .tool-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 7px; }
    .pilot-shell .tool { font-size: 11px; min-height: 40px; }
    .tool strong { color: var(--pp-blue); font-size: 10px; }
    .pilot-shell .help { display: block; border: 0; background: transparent; text-align: left; color: var(--pp-blue); font-size: 11px; padding: 8px 0; }
    .help-body { background: var(--pp-card); padding: 10px; border-radius: 8px; font-size: 11px; color: var(--pp-muted); }
    .help-body p { margin: 0 0 8px; } .help-body p:last-child { margin-bottom: 0; }
    footer { color: var(--pp-muted); margin-top: 8px; font-size: 10px; line-height: 1.5; }
    @media (max-width: 340px) { .pilot-shell { padding: 8px; } .pilot-shell .layer { padding: 5px; font-size: 10px; } }
</style>
