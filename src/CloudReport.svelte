<script>
    import {cloudPercent, cloudSamplesText, fmt} from './flightWeather.mjs';
    export let weather;
    $: firstCloud = weather.profile.find(p => p.cloudPct > 0);
    $: baseLocal = Number.isFinite(weather.cloudBaseMslFt) && Number.isFinite(weather.terrainFt)
        ? weather.cloudBaseMslFt - weather.terrainFt : null;
</script>

<section class="clouds" aria-label="Nubes y crucero">
    <h3>Nubes y crucero</h3>
    <dl>
        <dt>Crucero solicitado</dt>
        <dd>{fmt(weather.inputFt)} ft {weather.reference}</dd>
        {#if Number.isFinite(weather.altitudeFt) && Number.isFinite(weather.clearanceFt)}
            <dt>Equivalencia en el punto</dt>
            <dd>{weather.reference==='AGL'?fmt(weather.altitudeFt)+' ft MSL':fmt(weather.clearanceFt)+' ft AGL'}</dd>
        {:else}<dt>Elevación local</dt><dd>Sin dato para convertir</dd>{/if}
        <dt>Base de nubes</dt>
        <dd>{#if Number.isFinite(weather.cloudBaseFt)}{fmt(weather.cloudBaseFt)} ft AGL del modelo
            {#if Number.isFinite(weather.cloudBaseMslFt)}<small>{fmt(weather.cloudBaseMslFt)} ft MSL</small>{/if}
            {#if Number.isFinite(baseLocal)}<small>{fmt(baseLocal)} ft sobre el terreno local</small>{/if}
            {:else}Sin dato{/if}</dd>
        {#if firstCloud}<dt>Primer nivel muestreado con nubes</dt>
            <dd>{cloudPercent(firstCloud.cloudPct)}<small>{fmt(firstCloud.heightFt)} ft MSL · {fmt(firstCloud.aglFt)} ft AGL</small></dd>{/if}
    </dl>
    <div class="samples">
        <strong>{weather.cruiseCloud?.samples.length===2?'Niveles que enmarcan el crucero':'Cobertura en crucero'}</strong>
        <p>{cloudSamplesText(weather.cruiseCloud)}</p>
        {#if weather.cruiseCloud?.samples.length===2}<small>Entre ambos niveles el modelo no da un porcentaje a la altura exacta.</small>{/if}
        {#if !Number.isFinite(weather.modelTerrainFt)}<small>Falta la elevación del modelo para verificar los niveles bajos.</small>{/if}
    </div>
</section>
<style>
    .clouds{margin:10px 0;padding:12px;border:1px solid #415972;border-radius:9px;background:#18283a;color:#edf4fb}
    h3{margin:0 0 8px;font-size:14px}
    dl{display:grid;grid-template-columns:1fr 1fr;align-items:baseline;gap:7px;margin:0;font-size:12px}
    dt,small{color:#b6c9d8} dd{margin:0;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
    small{display:block;font-size:11px;font-weight:400}.samples{border-top:1px solid #415972;margin-top:10px;padding-top:8px}
    p{margin:3px 0 0;font-variant-numeric:tabular-nums}
</style>
