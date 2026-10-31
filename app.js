/**
 * RBT Big Data Analytics - Interactive Map & Dashboard
 * 100% DADOS REAIS: Associação Brasileira de Transplante de Órgãos (ABTO) / IBGE (2015-2025)
 * Chave Oficial CARTO Basemaps: cb1_4ytd_1_f3e2a2f72e115d6b20429838
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State & Stored CARTO API Key
  const storedCartoKey = localStorage.getItem('carto_api_key') || 'cb1_4ytd_1_f3e2a2f72e115d6b20429838';

  const state = {
    year: 2025,
    period: 'annual', // 'annual', 'pre', 'pandemic', 'post'
    metric: 'Doadores_Efetivos_PMP',
    region: 'ALL', // 'ALL', 'Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'
    selectedUF: null,
    isPlaying: false,
    playTimer: null,
    minYear: 2015,
    maxYear: 2025,
    cartoKey: storedCartoKey,
    organChartType: 'bar' // 'bar' (horizontal bar) or 'doughnut'
  };

  const PERIODS = {
    'annual': { label: 'Ano Específico', years: [2025] },
    'pre': { label: 'Pré-Pandemia (2015-2019)', years: [2015, 2016, 2017, 2018, 2019] },
    'pandemic': { label: 'Pandemia (2020-2021)', years: [2020, 2021] },
    'post': { label: 'Pós-Pandemia (2022-2025)', years: [2022, 2023, 2024, 2025] }
  };

  // Metrics Configuration
  const METRICS = {
    'Doadores_Efetivos_PMP': {
      label: 'Taxa de Doadores Efetivos (PMP)',
      shortLabel: 'Doadores (PMP)',
      unit: 'PMP',
      format: (v) => (v || 0).toFixed(1),
      higherIsBetter: true,
      colorType: 'blue-green'
    },
    'Notificacoes_PMP': {
      label: 'Notificações de Potenciais Doadores (PMP)',
      shortLabel: 'Notificações (PMP)',
      unit: 'PMP',
      format: (v) => (v || 0).toFixed(1),
      higherIsBetter: true,
      colorType: 'blue-green'
    },
    'Tx_Total_Geral_PMP': {
      label: 'Transplantes Realizados (PMP)',
      shortLabel: 'Transplantes (PMP)',
      unit: 'PMP',
      format: (v) => (v || 0).toFixed(1),
      higherIsBetter: true,
      colorType: 'blue-green'
    },
    'Recusa_Familiar_Pct': {
      label: 'Taxa de Recusa Familiar (%)',
      shortLabel: 'Recusa Familiar (%)',
      unit: '%',
      format: (v) => (v || 0).toFixed(1) + '%',
      higherIsBetter: false,
      colorType: 'refusal'
    },
    'Lista_Ativos_Total_Geral': {
      label: 'Fila de Espera Ativa (Total de Pacientes)',
      shortLabel: 'Fila de Espera',
      unit: 'pacientes',
      format: (v) => Math.round(v || 0).toLocaleString('pt-BR'),
      higherIsBetter: false,
      colorType: 'amber'
    }
  };

  // Verify Data availability
  if (!window.RBT_DATA || !window.BRAZIL_GEOJSON) {
    console.error('Dados do RBT ou GeoJSON não carregados!');
    return;
  }

  const { painel_uf, serie_nacional, serie_regional, infraestrutura } = window.RBT_DATA;

  // Global Chart instances
  let nationalChart = null;
  let organChart = null;
  let modalEvolutionChart = null;
  let modalPieChart = null;

  // Leaflet Map & Layers
  let map = null;
  let geojsonLayer = null;
  let activeTileLayer = null;
  let layerControl = null;

  // Initialize Map
  function initMap() {
    map = L.map('map', {
      center: [-14.235, -51.925],
      zoom: 4,
      minZoom: 3,
      maxZoom: 10,
      zoomControl: true,
      attributionControl: true
    });

    setupCartoLayers();
    renderGeoJson();
  }

  function setupCartoLayers() {
    if (activeTileLayer) {
      map.removeLayer(activeTileLayer);
    }
    if (layerControl) {
      map.removeControl(layerControl);
    }

    const cartoVoyager = L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${state.cartoKey}`, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://carto.com/">CARTO Basemaps (Key Ativa)</a> &copy; OpenStreetMap'
    });

    const cartoDark = L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${state.cartoKey}`, {
      maxZoom: 19,
      attribution: '&copy; CARTO Basemaps (Key Ativa)'
    });

    const cartoLight = L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${state.cartoKey}`, {
      maxZoom: 19,
      attribution: '&copy; CARTO Basemaps (Key Ativa)'
    });

    cartoVoyager.addTo(map);
    activeTileLayer = cartoVoyager;

    const baseLayers = {
      "CARTO Voyager (Sua Chave)": cartoVoyager,
      "CARTO Dark Matter": cartoDark,
      "CARTO Positron Light": cartoLight
    };
    layerControl = L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    const shortKey = state.cartoKey.substring(0, 10) + '...';
    const labelEl = document.getElementById('header-carto-label');
    if (labelEl) labelEl.textContent = `CARTO Key: ${shortKey}`;

    const previewEl = document.getElementById('carto-tile-url-preview');
    if (previewEl) {
      previewEl.textContent = `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${state.cartoKey}`;
    }
  }

  // Get active years based on selected period
  function getActiveYears() {
    if (state.period === 'annual') {
      return [state.year];
    }
    return PERIODS[state.period].years;
  }

  // Helper: Get Aggregated Records for a given UF across active years
  function getStateAggregatedData(ufSigla) {
    const years = getActiveYears();
    const rows = painel_uf.filter(r => r.UF_Sigla === ufSigla && years.includes(r.Ano));
    if (rows.length === 0) return null;

    const n = rows.length;
    // Mean of populations
    const pop = Math.round(rows.reduce((acc, r) => acc + r.Populacao_IBGE, 0) / n);
    const doadoresTot = rows.reduce((acc, r) => acc + r.Doadores_Efetivos_N, 0);
    const doadoresAvg = doadoresTot / n;
    const notifTot = rows.reduce((acc, r) => acc + r.Notificacoes_N, 0);
    const notifAvg = notifTot / n;

    const pmpCalc = pop > 0 ? (doadoresAvg / pop * 1e6) : 0;
    const notifPmpCalc = pop > 0 ? (notifAvg / pop * 1e6) : 0;

    const txTotalSum = rows.reduce((acc, r) => acc + r.Tx_Total_Geral_N, 0);
    const txTotalAvg = txTotalSum / n;
    const txOrgaosSum = rows.reduce((acc, r) => acc + r.Tx_Orgaos_Solidos_N, 0);
    const txOrgaosAvg = txOrgaosSum / n;
    const txCorneaSum = rows.reduce((acc, r) => acc + r.Tx_Cornea_N, 0);
    const txCorneaAvg = txCorneaSum / n;
    const txRimVivoSum = rows.reduce((acc, r) => acc + r.Tx_Rim_Vivo_N, 0);
    const txRimVivoAvg = txRimVivoSum / n;
    const txRimFalecidoSum = rows.reduce((acc, r) => acc + r.Tx_Rim_Falecido_N, 0);
    const txRimFalecidoAvg = txRimFalecidoSum / n;
    const txRimTotalSum = rows.reduce((acc, r) => acc + r.Tx_Rim_Total_N, 0);
    const txRimTotalAvg = txRimTotalSum / n;
    const txFigadoSum = rows.reduce((acc, r) => acc + r.Tx_Figado_N, 0);
    const txFigadoAvg = txFigadoSum / n;
    const txCoracaoSum = rows.reduce((acc, r) => acc + r.Tx_Coracao_N, 0);
    const txCoracaoAvg = txCoracaoSum / n;
    const txPancreasSum = rows.reduce((acc, r) => acc + r.Tx_Pancreas_N, 0);
    const txPancreasAvg = txPancreasSum / n;
    const txPulmaoSum = rows.reduce((acc, r) => acc + r.Tx_Pulmao_N, 0);
    const txPulmaoAvg = txPulmaoSum / n;

    const txTotalPmp = pop > 0 ? (txTotalAvg / pop * 1e6) : 0;

    const entrevSum = rows.reduce((acc, r) => acc + r.Entrevistas_Realizadas_N, 0);
    const recusaSum = rows.reduce((acc, r) => acc + r.Recusa_Familiar_N, 0);
    const recusaPct = entrevSum > 0 ? ((recusaSum / entrevSum) * 100) : 0;

    const filaSum = rows.reduce((acc, r) => acc + r.Lista_Ativos_Total_Geral, 0);
    const filaAvg = filaSum / n;

    const filaRimAvg = rows.reduce((acc, r) => acc + r.Lista_Ativos_Rim, 0) / n;
    const filaFigadoAvg = rows.reduce((acc, r) => acc + r.Lista_Ativos_Figado, 0) / n;
    const filaCoracaoAvg = rows.reduce((acc, r) => acc + r.Lista_Ativos_Coracao, 0) / n;
    const filaCorneaAvg = rows.reduce((acc, r) => acc + r.Lista_Ativos_Cornea, 0) / n;

    const obitosFilaSum = rows.reduce((acc, r) => acc + r.Lista_Mortalidade_Anual_Total, 0);
    const obitosFilaAvg = obitosFilaSum / n;

    const mascSum = rows.reduce((acc, r) => acc + r.Doador_Masc, 0);
    const femSum = rows.reduce((acc, r) => acc + r.Doador_Fem, 0);
    const avcSum = rows.reduce((acc, r) => acc + r.Causa_AVC, 0);
    const tceSum = rows.reduce((acc, r) => acc + r.Causa_TCE, 0);
    const sangOSum = rows.reduce((acc, r) => acc + r.Sangue_O, 0);
    const sangASum = rows.reduce((acc, r) => acc + r.Sangue_A, 0);
    const sangBSum = rows.reduce((acc, r) => acc + r.Sangue_B, 0);
    const sangABSum = rows.reduce((acc, r) => acc + r.Sangue_AB, 0);

    return {
      UF_Sigla: ufSigla,
      UF_Nome: rows[0].UF_Nome,
      Regiao: rows[0].Regiao,
      Populacao_IBGE: pop,
      Doadores_Efetivos_N: Math.round(doadoresAvg),
      Doadores_Efetivos_PMP: pmpCalc,
      Notificacoes_N: Math.round(notifAvg),
      Notificacoes_PMP: notifPmpCalc,
      Tx_Total_Geral_N: Math.round(txTotalAvg),
      Tx_Total_Geral_PMP: txTotalPmp,
      Tx_Orgaos_Solidos_N: Math.round(txOrgaosAvg),
      Tx_Cornea_N: Math.round(txCorneaAvg),
      Tx_Rim_Total_N: Math.round(txRimTotalAvg),
      Tx_Rim_Vivo_N: Math.round(txRimVivoAvg),
      Tx_Rim_Falecido_N: Math.round(txRimFalecidoAvg),
      Tx_Figado_N: Math.round(txFigadoAvg),
      Tx_Coracao_N: Math.round(txCoracaoAvg),
      Tx_Pancreas_N: Math.round(txPancreasAvg),
      Tx_Pulmao_N: Math.round(txPulmaoAvg),
      Entrevistas_Realizadas_N: Math.round(entrevSum / n),
      Recusa_Familiar_N: Math.round(recusaSum / n),
      Recusa_Familiar_Pct: recusaPct,
      Lista_Ativos_Total_Geral: Math.round(filaAvg),
      Lista_Ativos_Rim: Math.round(filaRimAvg),
      Lista_Ativos_Figado: Math.round(filaFigadoAvg),
      Lista_Ativos_Coracao: Math.round(filaCoracaoAvg),
      Lista_Ativos_Cornea: Math.round(filaCorneaAvg),
      Lista_Mortalidade_Anual_Total: Math.round(obitosFilaAvg),
      Doador_Masc: Math.round(mascSum / n),
      Doador_Fem: Math.round(femSum / n),
      Causa_AVC: Math.round(avcSum / n),
      Causa_TCE: Math.round(tceSum / n),
      Sangue_O: Math.round(sangOSum / n),
      Sangue_A: Math.round(sangASum / n),
      Sangue_B: Math.round(sangBSum / n),
      Sangue_AB: Math.round(sangABSum / n)
    };
  }

  // Helper: Get Regional or National Aggregate
  function getScopeAggregatedData(targetRegion) {
    const years = getActiveYears();
    let rows = painel_uf.filter(r => r.UF_Sigla !== 'BR' && years.includes(r.Ano));

    if (targetRegion !== 'ALL') {
      rows = rows.filter(r => r.Regiao === targetRegion);
    }

    const nYears = years.length;
    // Calculate total distinct states in this scope
    const ufs = Array.from(new Set(rows.map(r => r.UF_Sigla)));

    // Total population of the scope (mean across years)
    let popScope = 0;
    ufs.forEach(uf => {
      const ufRows = rows.filter(r => r.UF_Sigla === uf);
      const popAvg = ufRows.reduce((acc, r) => acc + r.Populacao_IBGE, 0) / ufRows.length;
      popScope += popAvg;
    });

    const doadTot = rows.reduce((acc, r) => acc + r.Doadores_Efetivos_N, 0);
    const doadAvg = doadTot / nYears;
    const pmpScope = popScope > 0 ? (doadAvg / popScope * 1e6) : 0;

    const notifTot = rows.reduce((acc, r) => acc + r.Notificacoes_N, 0);
    const notifAvg = notifTot / nYears;
    const notifPmpScope = popScope > 0 ? (notifAvg / popScope * 1e6) : 0;

    const txTot = rows.reduce((acc, r) => acc + r.Tx_Total_Geral_N, 0);
    const txTotAvg = txTot / nYears;
    const txOrgaosTot = rows.reduce((acc, r) => acc + r.Tx_Orgaos_Solidos_N, 0);
    const txOrgaosAvg = txOrgaosTot / nYears;
    const txCorneaTot = rows.reduce((acc, r) => acc + r.Tx_Cornea_N, 0);
    const txCorneaAvg = txCorneaTot / nYears;
    const txRimVivoTot = rows.reduce((acc, r) => acc + r.Tx_Rim_Vivo_N, 0);
    const txRimVivoAvg = txRimVivoTot / nYears;
    const txRimFalecidoTot = rows.reduce((acc, r) => acc + r.Tx_Rim_Falecido_N, 0);
    const txRimFalecidoAvg = txRimFalecidoTot / nYears;
    const txRimTotSum = rows.reduce((acc, r) => acc + r.Tx_Rim_Total_N, 0);
    const txRimTotAvg = txRimTotSum / nYears;
    const txFigadoTot = rows.reduce((acc, r) => acc + r.Tx_Figado_N, 0);
    const txFigadoAvg = txFigadoTot / nYears;
    const txCoracaoTot = rows.reduce((acc, r) => acc + r.Tx_Coracao_N, 0);
    const txCoracaoAvg = txCoracaoTot / nYears;
    const txPancreasTot = rows.reduce((acc, r) => acc + r.Tx_Pancreas_N, 0);
    const txPancreasAvg = txPancreasTot / nYears;
    const txPulmaoTot = rows.reduce((acc, r) => acc + r.Tx_Pulmao_N, 0);
    const txPulmaoAvg = txPulmaoTot / nYears;

    const entrevTot = rows.reduce((acc, r) => acc + r.Entrevistas_Realizadas_N, 0);
    const recusaTot = rows.reduce((acc, r) => acc + r.Recusa_Familiar_N, 0);
    const recusaPct = entrevTot > 0 ? ((recusaTot / entrevTot) * 100) : 0;

    const filaTot = rows.reduce((acc, r) => acc + r.Lista_Ativos_Total_Geral, 0);
    const filaAvg = filaTot / nYears;

    const obitosFilaTot = rows.reduce((acc, r) => acc + r.Lista_Mortalidade_Anual_Total, 0);
    const obitosFilaAvg = obitosFilaTot / nYears;

    return {
      scopeName: targetRegion === 'ALL' ? 'Brasil (Nacional)' : `Região ${targetRegion}`,
      isRegion: targetRegion !== 'ALL',
      targetRegion: targetRegion,
      pop: Math.round(popScope),
      doadores: Math.round(doadAvg),
      pmp: pmpScope,
      notif: Math.round(notifAvg),
      notifPmp: notifPmpScope,
      txTotal: Math.round(txTotAvg),
      txOrgaos: Math.round(txOrgaosAvg),
      txCornea: Math.round(txCorneaAvg),
      txRimTotal: Math.round(txRimTotAvg),
      txRimVivo: Math.round(txRimVivoAvg),
      txRimFalecido: Math.round(txRimFalecidoAvg),
      txFigado: Math.round(txFigadoAvg),
      txCoracao: Math.round(txCoracaoAvg),
      txPancreas: Math.round(txPancreasAvg),
      txPulmao: Math.round(txPulmaoAvg),
      recusaPct: recusaPct,
      recusaN: Math.round(recusaTot / nYears),
      entrevistasN: Math.round(entrevTot / nYears),
      fila: Math.round(filaAvg),
      obitosFila: Math.round(obitosFilaAvg)
    };
  }

  // Calculate Min/Max for current metric across active states
  function getMetricExtent() {
    const states = window.RBT_DATA.ufs;
    const values = states.map(uf => {
      const data = getStateAggregatedData(uf);
      return data ? (data[state.metric] || 0) : 0;
    });

    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min: min >= 0 ? min : 0, max: max > 0 ? max : 1 };
  }

  // Color Interpolation for Choropleth
  function getColor(val, min, max, colorType) {
    if (val === undefined || val === null || isNaN(val)) return '#334155';
    const range = max - min || 1;
    let t = (val - min) / range;
    t = Math.max(0, Math.min(1, t));

    if (colorType === 'refusal') {
      if (t < 0.35) return '#10b981'; // Green
      if (t < 0.55) return '#f59e0b'; // Amber
      if (t < 0.75) return '#f97316'; // Laranja
      return '#f43f5e'; // Vermelho
    } else if (colorType === 'amber') {
      const r = Math.round(30 + t * 225);
      const g = Math.round(41 + t * 90);
      const b = Math.round(59 + (1 - t) * 60);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      if (t < 0.20) return '#0284c7';
      if (t < 0.45) return '#06b6d4';
      if (t < 0.70) return '#14b8a6';
      if (t < 0.88) return '#10b981';
      return '#34d399';
    }
  }

  // Update Map Styles & Hover Tooltips
  function renderGeoJson() {
    const { min, max } = getMetricExtent();
    const metricConfig = METRICS[state.metric];

    if (geojsonLayer) {
      map.removeLayer(geojsonLayer);
    }

    const matchingBounds = [];

    geojsonLayer = L.geoJson(window.BRAZIL_GEOJSON, {
      style: (feature) => {
        const uf = feature.properties.UF_Sigla;
        const reg = feature.properties.Regiao;
        const stateRecord = getStateAggregatedData(uf);
        const val = stateRecord ? stateRecord[state.metric] : 0;
        const isRegionMatch = state.region === 'ALL' || reg === state.region;

        return {
          fillColor: isRegionMatch ? getColor(val, min, max, metricConfig.colorType) : '#475569',
          weight: isRegionMatch ? 2.0 : 1.0,
          opacity: 1,
          color: isRegionMatch ? '#ffffff' : '#334155',
          fillOpacity: isRegionMatch ? 0.85 : 0.15
        };
      },
      onEachFeature: (feature, layer) => {
        const uf = feature.properties.UF_Sigla;
        const nome = feature.properties.UF_Nome;
        const reg = feature.properties.Regiao;

        if (state.region === 'ALL' || reg === state.region) {
          matchingBounds.push(layer.getBounds ? layer.getBounds() : null);
        }

        layer.on({
          mouseover: (e) => {
            const currentLayer = e.target;
            currentLayer.setStyle({
              weight: 3.5,
              color: '#0284c7',
              fillOpacity: 0.95
            });
            currentLayer.bringToFront();

            const record = getStateAggregatedData(uf);
            const val = record ? metricConfig.format(record[state.metric]) : 'N/D';
            const pop = record ? record.Populacao_IBGE.toLocaleString('pt-BR') : 'N/D';
            const doadores = record ? record.Doadores_Efetivos_N : 0;
            const txTotal = record ? record.Tx_Total_Geral_N : 0;
            const txOrgaos = record ? record.Tx_Orgaos_Solidos_N : 0;
            const txCornea = record ? record.Tx_Cornea_N : 0;
            const txRimVivo = record ? record.Tx_Rim_Vivo_N : 0;

            const saldo = txTotal - doadores;
            const saldoHtml = saldo > 0 
              ? `<div class="tooltip-row" style="color: #34d399; font-size: 0.72rem; margin-top: 4px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 3px;">
                   <span>Balanço Interestadual:</span>
                   <span>+${saldo} acima dos doadores locais</span>
                 </div>`
              : '';

            const periodLabel = state.period === 'annual' ? `Ano ${state.year}` : PERIODS[state.period].label;

            const tooltipHtml = `
              <div class="custom-map-tooltip" style="max-width: 290px;">
                <div class="tooltip-header">
                  <span class="tooltip-title">${nome} (${uf})</span>
                  <span style="font-size: 0.7rem; color: #94a3b8;">${reg} • ${periodLabel}</span>
                </div>
                <div class="tooltip-row">
                  <span>${metricConfig.shortLabel}:</span>
                  <span class="tooltip-val" style="color: #38bdf8;">${val}</span>
                </div>
                <div class="tooltip-row">
                  <span>Doadores Efetivos (Média/Ano):</span>
                  <span class="tooltip-val">${doadores}</span>
                </div>
                <div class="tooltip-row">
                  <span>Transplantes Totais (Média/Ano):</span>
                  <span class="tooltip-val">${txTotal}</span>
                </div>
                <div class="tooltip-row" style="color: #94a3b8; font-size: 0.7rem;">
                  <span>&bull; Órgãos Sólidos: ${txOrgaos} (${txRimVivo} doador vivo)</span>
                </div>
                <div class="tooltip-row" style="color: #94a3b8; font-size: 0.7rem;">
                  <span>&bull; Córneas: ${txCornea}</span>
                </div>
                ${saldoHtml}
                <div class="tooltip-row">
                  <span>População IBGE:</span>
                  <span class="tooltip-val">${pop}</span>
                </div>
                <div style="font-size: 0.65rem; color: #64748b; margin-top: 4px;">
                  💡 Clique para abrir o raio-x analítico histórico da UF
                </div>
              </div>
            `;
            layer.bindTooltip(tooltipHtml, { sticky: true, className: 'leaflet-tooltip-pane' }).openTooltip();
          },
          mouseout: (e) => {
            geojsonLayer.resetStyle(e.target);
          },
          click: () => {
            openStateDeepDive(uf);
          }
        });
      }
    }).addTo(map);

    updateLegend(min, max, metricConfig);
  }

  // Update Legend UI
  function updateLegend(min, max, config) {
    document.getElementById('legend-title').textContent = config.shortLabel;
    document.getElementById('legend-min').textContent = config.format(min);
    document.getElementById('legend-mid').textContent = config.format((min + max) / 2);
    document.getElementById('legend-max').textContent = config.format(max);

    const scaleBar = document.getElementById('legend-scale-bar');
    if (config.colorType === 'refusal') {
      scaleBar.style.background = 'linear-gradient(to right, #10b981, #f59e0b, #f97316, #f43f5e)';
    } else if (config.colorType === 'amber') {
      scaleBar.style.background = 'linear-gradient(to right, #1e293b, #f59e0b, #f43f5e)';
    } else {
      scaleBar.style.background = 'linear-gradient(to right, #0284c7, #06b6d4, #14b8a6, #10b981, #34d399)';
    }
  }

  // Update the 5 KPI Cards: Fully Dynamic by Scope (National or Regional) & Period (Annual or Pre/Pandemic/Post)
  function updateKPICards() {
    const scopeData = getScopeAggregatedData(state.region);
    const periodLabel = state.period === 'annual' ? `em ${state.year}` : `no período ${PERIODS[state.period].label}`;
    const scopeName = scopeData.isRegion ? `Região ${scopeData.targetRegion}` : 'Total Brasil';

    // 1. Doadores Efetivos
    document.getElementById('kpi-doadores-val').textContent = scopeData.doadores.toLocaleString('pt-BR');
    document.getElementById('kpi-doadores-sub').textContent = `${scopeName} ${periodLabel}`;

    // 2. Taxa PMP
    document.getElementById('kpi-pmp-val').textContent = scopeData.pmp.toFixed(1);

    // 3. Transplantes Realizados
    document.getElementById('kpi-tx-val').textContent = scopeData.txTotal.toLocaleString('pt-BR');
    document.getElementById('kpi-tx-sub').textContent = `${scopeData.txOrgaos.toLocaleString('pt-BR')} órgãos sólidos + ${scopeData.txCornea.toLocaleString('pt-BR')} córneas`;

    // 4. Fila de Espera
    document.getElementById('kpi-fila-val').textContent = scopeData.fila.toLocaleString('pt-BR');

    // 5. Recusa Familiar
    document.getElementById('kpi-recusa-val').textContent = `${scopeData.recusaPct.toFixed(1)}%`;
    const recusaSub = document.getElementById('kpi-recusa-sub');
    if (recusaSub) {
      recusaSub.textContent = `Em entrevistas (${scopeName})`;
    }

    // 6. Atualizar Popover Matemático dinamicamente para o Escopo e Período Ativos
    const popoverMath = document.getElementById('popover-tx-math');
    if (popoverMath) {
      const doad = scopeData.doadores;
      const orgaos = scopeData.txOrgaos;
      const total = scopeData.txTotal;
      const cornea = scopeData.txCornea;
      const rimFal = scopeData.txRimFalecido;
      const rimVivo = scopeData.txRimVivo;
      const rimTot = scopeData.txRimTotal;
      const fig = scopeData.txFigado;
      const cor = scopeData.txCoracao;
      const pan = scopeData.txPancreas;
      const pul = scopeData.txPulmao;

      popoverMath.innerHTML = `
        <div class="popover-header">
          <span>🧬</span>
          <span>Matemática [${scopeName} - ${periodLabel}]: ${doad.toLocaleString('pt-BR')} Doadores &rarr; ${orgaos.toLocaleString('pt-BR')} Órgãos &rarr; ${total.toLocaleString('pt-BR')} Transplantes</span>
        </div>
        <div class="popover-content">
          <p><strong>1. Multi-Doação Regional:</strong><br>
          Cada doador falecido possui <strong>2 rins</strong>. No recorte de <strong>${scopeName}</strong> (${periodLabel}), os doadores geraram <strong>${rimFal.toLocaleString('pt-BR')} transplantes renais</strong> de falecidos, <strong>${fig.toLocaleString('pt-BR')} fígados</strong>, <strong>${cor.toLocaleString('pt-BR')} corações</strong>, <strong>${pan.toLocaleString('pt-BR')} pâncreas</strong> e <strong>${pul.toLocaleString('pt-BR')} pulmões</strong>.</p>
          
          <p><strong>2. Doadores Vivos (Rim):</strong><br>
          Foram <strong>${rimVivo.toLocaleString('pt-BR')} transplantes renais com doador vivo</strong> na região. Doadores vivos não contam como óbitos.</p>

          <div class="math-breakdown">
            <div>${rimFal.toLocaleString('pt-BR')} (Rim Falecido) + ${rimVivo.toLocaleString('pt-BR')} (Rim Vivo) = ${rimTot.toLocaleString('pt-BR')} Rins</div>
            <div>+ ${fig.toLocaleString('pt-BR')} (Fígado) + ${cor.toLocaleString('pt-BR')} (Coração) + ${pan.toLocaleString('pt-BR')} (Pâncreas) + ${pul.toLocaleString('pt-BR')} (Pulmão)</div>
            <div class="math-sum">= ${orgaos.toLocaleString('pt-BR')} Órgãos Sólidos Transplantados</div>
            <div>+ ${cornea.toLocaleString('pt-BR')} Córneas (Tecidos oculares)</div>
            <div class="math-total">= ${total.toLocaleString('pt-BR')} Transplantes Totais em ${scopeName}</div>
          </div>

          <p style="margin-top: 6px; font-size: 0.72rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 6px;">
            <strong>Por que alguns estados/regiões têm mais transplantes que doadores?</strong><br>
            Centros médicos de referência realizam procedimentos de alta complexidade e recebem órgãos de outras localidades via Sistema Nacional de Transplantes (SNT / FAB).
          </p>
        </div>
      `;
    }

    // 7. Atualizar Popover da Taxa PMP dinamicamente com a população e doadores do escopo ativo
    const popoverPmpEx = document.getElementById('popover-pmp-example');
    if (popoverPmpEx) {
      const popNum = scopeData.populacao || 213421037;
      popoverPmpEx.textContent = `Cálculo ${scopeName} (${periodLabel}): (${scopeData.doadores.toLocaleString('pt-BR')} ÷ ${popNum.toLocaleString('pt-BR')}) × 1.000.000 = ${scopeData.pmp.toFixed(1)} PMP`;
    }
  }

  // Update Ranking Leaderboard
  function updateRanking() {
    const listEl = document.getElementById('ranking-list');
    const metricConfig = METRICS[state.metric];
    const periodLabel = state.period === 'annual' ? state.year : PERIODS[state.period].label;
    document.getElementById('ranking-year-label').textContent = periodLabel;
    document.getElementById('ranking-metric-unit').textContent = metricConfig.unit;

    const ufs = window.RBT_DATA.ufs;
    let records = ufs.map(uf => getStateAggregatedData(uf)).filter(Boolean);

    if (state.region !== 'ALL') {
      records = records.filter(r => r.Regiao === state.region);
    }

    records.sort((a, b) => {
      const valA = a[state.metric] || 0;
      const valB = b[state.metric] || 0;
      return (valB - valA);
    });

    listEl.innerHTML = '';
    records.slice(0, 10).forEach((item, index) => {
      const rankBadgeClass = index === 0 ? 'top-1' : index === 1 ? 'top-2' : index === 2 ? 'top-3' : '';
      const row = document.createElement('div');
      row.className = 'ranking-item';
      row.innerHTML = `
        <div class="ranking-left">
          <span class="rank-badge ${rankBadgeClass}">${index + 1}</span>
          <div>
            <span class="uf-tag">${item.UF_Sigla}</span>
            <span class="uf-name"> - ${item.UF_Nome}</span>
          </div>
        </div>
        <span class="ranking-value">${metricConfig.format(item[state.metric])}</span>
      `;
      row.onclick = () => openStateDeepDive(item.UF_Sigla);
      listEl.appendChild(row);
    });
  }

  // Render Bottom Charts: National Historical Series & Organ Breakdown
  function initCharts() {
    // 1. National Historical Series (2008 - 2025)
    const ctxNac = document.getElementById('chart-national-series').getContext('2d');
    const yearsNac = serie_nacional.map(r => r.Ano);
    const doadoresPmpNac = serie_nacional.map(r => r.Doadores_Efetivos_PMP);
    const txRimPmpNac = serie_nacional.map(r => r.Tx_Rim_Total_PMP);
    const txFigadoPmpNac = serie_nacional.map(r => r.Tx_Figado_PMP);

    nationalChart = new Chart(ctxNac, {
      type: 'line',
      data: {
        labels: yearsNac,
        datasets: [
          {
            label: 'Doadores Efetivos (PMP)',
            data: doadoresPmpNac,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointHoverRadius: 7,
            pointBackgroundColor: '#38bdf8'
          },
          {
            label: 'Tx Rim Total (PMP)',
            data: txRimPmpNac,
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#10b981'
          },
          {
            label: 'Tx Fígado (PMP)',
            data: txFigadoPmpNac,
            borderColor: '#a855f7',
            backgroundColor: 'transparent',
            tension: 0.35,
            borderWidth: 2,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBackgroundColor: '#a855f7'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }
          },
          tooltip: {
            backgroundColor: 'rgba(11, 15, 25, 0.98)',
            titleColor: '#38bdf8',
            titleFont: { family: 'Outfit', size: 13, weight: 'bold' },
            borderColor: 'rgba(56, 189, 248, 0.4)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              title: (items) => `Série Histórica Nacional • Ano ${items[0].label}`,
              label: function(context) {
                const year = context.label;
                const row = serie_nacional.find(r => r.Ano == year);
                if (context.dataset.label.includes('Doadores Efetivos')) {
                  const n = row && row.Doadores_Efetivos_N ? ` (${row.Doadores_Efetivos_N.toLocaleString('pt-BR')} doadores falecidos)` : '';
                  return ` 🫀 Doadores Efetivos: ${context.parsed.y.toFixed(1)} PMP${n}`;
                }
                if (context.dataset.label.includes('Rim')) {
                  const n = row && row.Tx_Rim_Total_N ? ` (${row.Tx_Rim_Total_N.toLocaleString('pt-BR')} tx renais)` : '';
                  return ` 🩸 Transplantes Rim: ${context.parsed.y.toFixed(1)} PMP${n}`;
                }
                if (context.dataset.label.includes('Fígado')) {
                  const n = row && row.Tx_Figado_N ? ` (${row.Tx_Figado_N.toLocaleString('pt-BR')} tx hepáticos)` : '';
                  return ` 🧪 Transplantes Fígado: ${context.parsed.y.toFixed(1)} PMP${n}`;
                }
                return ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)} PMP`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { family: 'Outfit' } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { family: 'Outfit' } }
          }
        }
      }
    });

    // 2. Organ Breakdown Chart
    renderOrganChart();
  }

  // Render Organ Breakdown (Supports Bar and Doughnut modes)
  function renderOrganChart() {
    const ctxOrg = document.getElementById('chart-organ-breakdown').getContext('2d');
    if (organChart) {
      organChart.destroy();
    }

    const scopeData = getScopeAggregatedData(state.region);
    const periodLabel = state.period === 'annual' ? state.year : PERIODS[state.period].label;
    const labelTitle = scopeData.isRegion ? `Região ${scopeData.targetRegion} (${periodLabel})` : `Brasil (${periodLabel})`;
    document.getElementById('organs-year-label').textContent = labelTitle;

    const labels = ['Córnea', 'Rim', 'Fígado', 'Coração', 'Pâncreas', 'Pulmão'];
    const dataValues = [
      scopeData.txCornea,
      scopeData.txRimTotal,
      scopeData.txFigado,
      scopeData.txCoracao,
      scopeData.txPancreas,
      scopeData.txPulmao
    ];
    const colors = [
      '#38bdf8', // Córnea
      '#10b981', // Rim
      '#a855f7', // Fígado
      '#f43f5e', // Coração
      '#6366f1', // Pâncreas
      '#f59e0b'  // Pulmão
    ];

    const totalTx = dataValues.reduce((a, b) => a + b, 0);

    if (state.organChartType === 'bar') {
      organChart = new Chart(ctxOrg, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Transplantes',
            data: dataValues,
            backgroundColor: colors,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: 'rgba(255, 255, 255, 0.1)'
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(11, 15, 25, 0.98)',
              titleColor: '#38bdf8',
              borderColor: 'rgba(56, 189, 248, 0.4)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const val = ctx.raw;
                  const pct = totalTx > 0 ? ((val / totalTx) * 100).toFixed(1) : '0';
                  let detail = '';
                  if (ctx.label === 'Rim') {
                    detail = ` (Falecido: ${scopeData.txRimFalecido.toLocaleString('pt-BR')} | Vivo: ${scopeData.txRimVivo.toLocaleString('pt-BR')})`;
                  }
                  return ` ${val.toLocaleString('pt-BR')} procedimentos (${pct}% do total)${detail}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.05)' },
              ticks: { 
                color: '#64748b', 
                font: { family: 'Outfit' },
                callback: (v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v
              }
            },
            y: {
              grid: { display: false },
              ticks: { color: '#ffffff', font: { family: 'Outfit', weight: '600' } }
            }
          }
        }
      });
    } else {
      organChart = new Chart(ctxOrg, {
        type: 'doughnut',
        data: {
          labels: labels,
          datasets: [{
            data: dataValues,
            backgroundColor: colors,
            borderColor: '#0f172a',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: { color: '#94a3b8', font: { family: 'Outfit', size: 11 } }
            },
            tooltip: {
              backgroundColor: 'rgba(15, 23, 42, 0.95)',
              borderWidth: 1,
              callbacks: {
                label: (context) => {
                  const val = context.raw;
                  const pct = totalTx > 0 ? ((val / totalTx) * 100).toFixed(1) : '0';
                  return ` ${context.label}: ${val.toLocaleString('pt-BR')} tx (${pct}%)`;
                }
              }
            }
          },
          cutout: '68%'
        }
      });
    }
  }

  // Update Organ Breakdown Chart for selected Scope & Period
  function updateOrganChart() {
    renderOrganChart();
  }

  // State Deep Dive Modal with 100% Real Clinical and Surgical Data
  function openStateDeepDive(uf) {
    state.selectedUF = uf;
    const record = getStateAggregatedData(uf);
    const scopeData = getScopeAggregatedData('ALL');
    if (!record) return;

    const periodLabel = state.period === 'annual' ? `Ano ${state.year}` : PERIODS[state.period].label;

    document.getElementById('modal-uf-sigla').textContent = uf;
    document.getElementById('modal-uf-nome').textContent = record.UF_Nome;
    document.getElementById('modal-uf-meta').textContent = `Região ${record.Regiao} • População IBGE: ${record.Populacao_IBGE.toLocaleString('pt-BR')} • Período: ${periodLabel}`;

    document.getElementById('modal-kpi-pmp').textContent = record.Doadores_Efetivos_PMP.toFixed(1);
    
    const diffPct = scopeData ? (((record.Doadores_Efetivos_PMP - scopeData.pmp) / (scopeData.pmp || 1)) * 100).toFixed(0) : 0;
    const compareEl = document.getElementById('modal-kpi-pmp-compare');
    if (diffPct >= 0) {
      compareEl.textContent = `+${diffPct}% acima da média Brasil (${scopeData.pmp.toFixed(1)})`;
      compareEl.style.color = '#34d399';
    } else {
      compareEl.textContent = `${diffPct}% abaixo da média Brasil (${scopeData.pmp.toFixed(1)})`;
      compareEl.style.color = '#f43f5e';
    }

    document.getElementById('modal-kpi-tx').textContent = record.Tx_Total_Geral_N.toLocaleString('pt-BR');
    document.getElementById('modal-kpi-tx-sub').textContent = `${record.Tx_Orgaos_Solidos_N.toLocaleString('pt-BR')} órgãos sólidos (${record.Tx_Rim_Vivo_N} doador vivo) + ${record.Tx_Cornea_N.toLocaleString('pt-BR')} córneas`;

    document.getElementById('modal-kpi-recusa').textContent = `${record.Recusa_Familiar_Pct.toFixed(1)}%`;
    document.getElementById('modal-kpi-recusa-sub').textContent = `${record.Recusa_Familiar_N} recusas em ${record.Entrevistas_Realizadas_N} entrevistas`;

    document.getElementById('modal-kpi-fila').textContent = record.Lista_Ativos_Total_Geral.toLocaleString('pt-BR');
    document.getElementById('modal-kpi-fila-sub').textContent = `Rim: ${record.Lista_Ativos_Rim} | Córnea: ${record.Lista_Ativos_Cornea} | Fígado: ${record.Lista_Ativos_Figado}`;

    const totalGender = record.Doador_Masc + record.Doador_Fem;
    if (totalGender > 0) {
      const mascPct = Math.round((record.Doador_Masc / totalGender) * 100);
      const femPct = 100 - mascPct;
      document.getElementById('modal-donor-gender').textContent = `Masc: ${record.Doador_Masc} (${mascPct}%) | Fem: ${record.Doador_Fem} (${femPct}%)`;
    } else {
      document.getElementById('modal-donor-gender').textContent = 'Sem doadores no período';
    }

    const totalCauses = record.Causa_AVC + record.Causa_TCE;
    if (totalCauses > 0) {
      const avcPct = Math.round((record.Causa_AVC / totalCauses) * 100);
      const tcePct = 100 - avcPct;
      document.getElementById('modal-donor-causes').textContent = `AVC: ${record.Causa_AVC} (${avcPct}%) | TCE: ${record.Causa_TCE} (${tcePct}%)`;
    } else {
      document.getElementById('modal-donor-causes').textContent = 'Sem registros no período';
    }

    const totalBlood = record.Sangue_O + record.Sangue_A + record.Sangue_B + record.Sangue_AB;
    if (totalBlood > 0) {
      document.getElementById('modal-donor-blood').textContent = `O: ${record.Sangue_O} | A: ${record.Sangue_A} | B: ${record.Sangue_B} | AB: ${record.Sangue_AB}`;
    } else {
      document.getElementById('modal-donor-blood').textContent = 'Sem doadores no período';
    }

    document.getElementById('modal-donor-mortality').textContent = `${record.Lista_Mortalidade_Anual_Total.toLocaleString('pt-BR')} óbitos na fila`;

    renderModalCharts(uf);

    const saldo = record.Tx_Total_Geral_N - record.Doadores_Efetivos_N;
    document.getElementById('state-spotlight').innerHTML = `
      <div style="text-align: left;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <strong style="color: #ffffff; font-size: 0.95rem;">${record.UF_Nome} (${uf})</strong>
          <span class="badge-tag">${record.Regiao}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; font-size: 0.75rem;">
          <div>Doadores PMP: <strong style="color: #38bdf8;">${record.Doadores_Efetivos_PMP.toFixed(1)}</strong></div>
          <div>Transplantes: <strong style="color: #10b981;">${record.Tx_Total_Geral_N}</strong></div>
          <div>Recusa: <strong style="color: #f43f5e;">${record.Recusa_Familiar_Pct.toFixed(1)}%</strong></div>
          <div>Fila de Espera: <strong style="color: #f59e0b;">${record.Lista_Ativos_Total_Geral}</strong></div>
        </div>
        <div style="margin-top: 0.5rem; font-size: 0.7rem; color: #94a3b8; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 4px;">
          ${saldo > 0 ? `🏥 <strong>Centro Receptor/Doador Vivo:</strong> realizou ${saldo} transplantes acima do total de doadores locais.` : `Doador Líquido: supriu filas locais e nacionais.`}
        </div>
      </div>
    `;

    document.getElementById('modal-state-deepdive').classList.add('active');
  }

  // Render Charts inside the State Deep Dive Modal
  function renderModalCharts(uf) {
    const stateHistory = painel_uf
      .filter(r => r.UF_Sigla === uf)
      .sort((a, b) => a.Ano - b.Ano);

    const years = stateHistory.map(r => r.Ano);
    const pmpData = stateHistory.map(r => r.Doadores_Efetivos_PMP);
    const txTotalData = stateHistory.map(r => r.Tx_Total_Geral_N);

    const ctxEvol = document.getElementById('modal-chart-evolution').getContext('2d');
    if (modalEvolutionChart) modalEvolutionChart.destroy();

    modalEvolutionChart = new Chart(ctxEvol, {
      type: 'line',
      data: {
        labels: years,
        datasets: [
          {
            label: 'Doadores Efetivos (PMP Real)',
            data: pmpData,
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            fill: true,
            tension: 0.35,
            yAxisID: 'y',
            borderWidth: 2.5
          },
          {
            label: 'Total de Transplantes (Real)',
            data: txTotalData,
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            tension: 0.35,
            borderDash: [5, 5],
            yAxisID: 'y1',
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } } }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#64748b', font: { family: 'Outfit' } }
          },
          y: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#38bdf8', font: { family: 'Outfit' } },
            title: { display: true, text: 'PMP', color: '#38bdf8' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { color: '#10b981', font: { family: 'Outfit' } },
            title: { display: true, text: 'Nº Transplantes', color: '#10b981' }
          }
        }
      }
    });

    const ctxPie = document.getElementById('modal-chart-pie').getContext('2d');
    if (modalPieChart) modalPieChart.destroy();

    const currentRecord = getStateAggregatedData(uf) || stateHistory[stateHistory.length - 1];
    modalPieChart = new Chart(ctxPie, {
      type: 'pie',
      data: {
        labels: ['Córnea', 'Rim Total', 'Fígado', 'Coração', 'Pulmão', 'Pâncreas'],
        datasets: [{
          data: [
            currentRecord.Tx_Cornea_N,
            currentRecord.Tx_Rim_Total_N,
            currentRecord.Tx_Figado_N,
            currentRecord.Tx_Coracao_N,
            currentRecord.Tx_Pulmao_N,
            currentRecord.Tx_Pancreas_N
          ],
          backgroundColor: [
            '#38bdf8',
            '#10b981',
            '#a855f7',
            '#f43f5e',
            '#f59e0b',
            '#6366f1'
          ],
          borderColor: '#0b0f19',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#94a3b8', font: { family: 'Outfit', size: 10 } }
          },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.label}: ${context.raw.toLocaleString('pt-BR')} tx`
            }
          }
        }
      }
    });
  }

  // Timeline playback controller
  function toggleTimelinePlay() {
    state.isPlaying = !state.isPlaying;
    const playIcon = document.getElementById('play-icon');
    const pauseIcon = document.getElementById('pause-icon');

    if (state.isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';

      state.playTimer = setInterval(() => {
        let nextYear = state.year + 1;
        if (nextYear > state.maxYear) {
          nextYear = state.minYear;
        }
        setYear(nextYear);
      }, 1800);
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
  }

  // Set Year and refresh all components
  function setYear(year) {
    state.year = parseInt(year);
    state.period = 'annual';
    document.querySelectorAll('.period-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-period') === 'annual');
    });

    document.getElementById('year-slider').value = state.year;
    document.getElementById('year-display').textContent = state.year;

    updateKPICards();
    renderGeoJson();
    updateRanking();
    updateOrganChart();
  }

  // Set Region and zoom / fit bounds
  function setRegion(reg) {
    state.region = reg;
    document.querySelectorAll('.region-pill').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-region') === reg);
    });

    // Zoom and pan to region
    if (reg === 'ALL') {
      map.setView([-14.235, -51.925], 4);
    } else {
      // Find bounds of matching states in GeoJSON
      const layers = [];
      geojsonLayer.eachLayer(layer => {
        if (layer.feature && layer.feature.properties && layer.feature.properties.Regiao === reg) {
          layers.push(layer);
        }
      });
      if (layers.length > 0) {
        const group = L.featureGroup(layers);
        map.fitBounds(group.getBounds(), { padding: [20, 20], maxZoom: 6 });
      }
    }

    updateKPICards();
    renderGeoJson();
    updateRanking();
    updateOrganChart();
  }

  // Set Epidemiological Period (Pre, Pandemic, Post, Annual)
  function setPeriod(period) {
    state.period = period;
    document.querySelectorAll('.period-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-period') === period);
    });

    const sliderWrapper = document.getElementById('timeline-control-wrapper');
    if (period === 'annual') {
      sliderWrapper.style.opacity = '1';
      sliderWrapper.style.pointerEvents = 'auto';
    } else {
      sliderWrapper.style.opacity = '0.4';
      sliderWrapper.style.pointerEvents = 'none';
      if (state.isPlaying) toggleTimelinePlay();
    }

    updateKPICards();
    renderGeoJson();
    updateRanking();
    updateOrganChart();
  }

  // Event Listeners Setup
  function setupEvents() {
    // Period Selector Pills
    document.querySelectorAll('.period-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const period = pill.getAttribute('data-period');
        setPeriod(period);
      });
    });

    // Region Pills
    document.querySelectorAll('.region-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const reg = pill.getAttribute('data-region');
        setRegion(reg);
      });
    });

    // Metric Selector Pills
    const metricPills = document.querySelectorAll('.metric-pill');
    metricPills.forEach(pill => {
      pill.addEventListener('click', () => {
        metricPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.metric = pill.getAttribute('data-metric');
        document.getElementById('map-active-metric-name').textContent = METRICS[state.metric].label;
        renderGeoJson();
        updateRanking();
      });
    });

    // Year Slider
    const yearSlider = document.getElementById('year-slider');
    yearSlider.addEventListener('input', (e) => {
      if (state.isPlaying) toggleTimelinePlay();
      setYear(e.target.value);
    });

    // Play/Pause Button
    document.getElementById('btn-play-timeline').addEventListener('click', toggleTimelinePlay);

    // Ischemia Modal
    const ischemiaModal = document.getElementById('modal-ischemia');
    const btnOpenIschemia = document.getElementById('btn-open-ischemia');
    if (btnOpenIschemia) {
      btnOpenIschemia.addEventListener('click', () => {
        ischemiaModal.classList.add('active');
      });
    }
    const btnCloseIschemia = document.getElementById('btn-close-ischemia-modal');
    if (btnCloseIschemia) {
      btnCloseIschemia.addEventListener('click', () => {
        ischemiaModal.classList.remove('active');
      });
    }
    ischemiaModal.addEventListener('click', (e) => {
      if (e.target.id === 'modal-ischemia') {
        ischemiaModal.classList.remove('active');
      }
    });

    // Close State Deep Dive Modal
    document.getElementById('btn-close-state-modal').addEventListener('click', () => {
      document.getElementById('modal-state-deepdive').classList.remove('active');
    });

    document.getElementById('modal-state-deepdive').addEventListener('click', (e) => {
      if (e.target.id === 'modal-state-deepdive') {
        document.getElementById('modal-state-deepdive').classList.remove('active');
      }
    });

    // Big Data Studio Modal
    const bigDataModal = document.getElementById('modal-bigdata-hub');
    document.getElementById('btn-open-bigdata').addEventListener('click', () => {
      bigDataModal.classList.add('active');
    });
    document.getElementById('btn-close-bigdata-modal').addEventListener('click', () => {
      bigDataModal.classList.remove('active');
    });
    bigDataModal.addEventListener('click', (e) => {
      if (e.target.id === 'modal-bigdata-hub') {
        bigDataModal.classList.remove('active');
      }
    });

    // CARTO Settings Modal
    const cartoModal = document.getElementById('modal-carto-settings');
    const btnOpenCarto = document.getElementById('btn-open-carto');
    if (btnOpenCarto) {
      btnOpenCarto.addEventListener('click', () => {
        document.getElementById('carto-api-key-input').value = state.cartoKey;
        cartoModal.classList.add('active');
      });
    }
    const btnCloseCarto = document.getElementById('btn-close-carto-modal');
    if (btnCloseCarto) {
      btnCloseCarto.addEventListener('click', () => {
        cartoModal.classList.remove('active');
      });
    }
    cartoModal.addEventListener('click', (e) => {
      if (e.target.id === 'modal-carto-settings') {
        cartoModal.classList.remove('active');
      }
    });

    // Save CARTO Key
    const btnSaveCarto = document.getElementById('btn-save-carto-key');
    if (btnSaveCarto) {
      btnSaveCarto.addEventListener('click', () => {
        const inputKey = document.getElementById('carto-api-key-input').value.trim();
        if (inputKey) {
          state.cartoKey = inputKey;
          localStorage.setItem('carto_api_key', inputKey);
          setupCartoLayers();
          btnSaveCarto.textContent = 'Chave Salva e Ativa!';
          btnSaveCarto.style.background = '#38bdf8';
          setTimeout(() => {
            btnSaveCarto.textContent = 'Salvar e Atualizar Mapa';
            btnSaveCarto.style.background = '#10b981';
            cartoModal.classList.remove('active');
          }, 1200);
        }
      });
    }

    // Big Data Code Snippet Tabs
    const codeBox = document.getElementById('code-snippet-box');
    const tabs = {
      'tab-polars': `<span style="color: #64748b;"># Big Data com Polars (Alta velocidade em Parquet)</span>
<span style="color: #f43f5e;">import</span> polars <span style="color: #f43f5e;">as</span> pl

<span style="color: #64748b;"># 1. Carregamento em microsegundos do Parquet consolidado</span>
df = pl.read_parquet(<span style="color: #a855f7;">"rbt_painel_uf_consolidado.parquet"</span>)

<span style="color: #64748b;"># 2. Análise de Eficiência Regional e Pandêmica</span>
ranking_eficiencia = (
    df.filter(pl.col(<span style="color: #a855f7;">"Ano"</span>) >= 2020)
      .groupBy([<span style="color: #a855f7;">"Regiao"</span>, <span style="color: #a855f7;">"Ano"</span>])
      .agg([
          pl.col(<span style="color: #a855f7;">"Doadores_Efetivos_N"</span>).sum().alias(<span style="color: #a855f7;">"total_doadores"</span>),
          pl.col(<span style="color: #a855f7;">"Tx_Total_Geral_N"</span>).sum().alias(<span style="color: #a855f7;">"total_transplantes"</span>),
          pl.col(<span style="color: #a855f7;">"Lista_Mortalidade_Anual_Total"</span>).sum().alias(<span style="color: #a855f7;">"obitos_fila"</span>)
      ])
      .sort([<span style="color: #a855f7;">"Ano"</span>, <span style="color: #a855f7;">"total_doadores"</span>], descending=[<span style="color: #38bdf8;">True</span>, <span style="color: #38bdf8;">True</span>])
)
print(ranking_eficiencia) `,

      'tab-pyspark': `<span style="color: #64748b;"># Processamento Distribuído com Apache Spark (PySpark / Databricks)</span>
<span style="color: #f43f5e;">from</span> pyspark.sql <span style="color: #f43f5e;">import</span> SparkSession
<span style="color: #f43f5e;">from</span> pyspark.sql.functions <span style="color: #f43f5e;">import</span> col, avg, sum

spark = SparkSession.builder.appName(<span style="color: #a855f7;">"RBT_BigData_Transplantes"</span>).getOrCreate()

<span style="color: #64748b;"># Leitura em lote do arquivo Parquet</span>
df_spark = spark.read.parquet(<span style="color: #a855f7;">"rbt_painel_uf_consolidado.parquet"</span>)

<span style="color: #64748b;"># Agregação por Região da taxa média de recusa e total de órgãos</span>
regional_agg = (
    df_spark.filter(col(<span style="color: #a855f7;">"UF_Sigla"</span>) != <span style="color: #a855f7;">"BR"</span>)
            .groupBy(<span style="color: #a855f7;">"Regiao"</span>)
            .agg(
                avg(<span style="color: #a855f7;">"Recusa_Familiar_Pct"</span>).alias(<span style="color: #a855f7;">"media_recusa"</span>),
                sum(<span style="color: #a855f7;">"Tx_Orgaos_Solidos_N"</span>).alias(<span style="color: #a855f7;">"total_orgaos"</span>)
            )
            .orderBy(col(<span style="color: #a855f7;">"total_orgaos"</span>).desc())
)
regional_agg.show()`,

      'tab-sql': `<span style="color: #64748b;">-- Comparação Epidemiológica Pré vs Pandemia vs Pós</span>
<span style="color: #f43f5e;">SELECT</span> 
    <span style="color: #f43f5e;">CASE</span> 
        <span style="color: #f43f5e;">WHEN</span> Ano < 2020 <span style="color: #f43f5e;">THEN</span> <span style="color: #a855f7;">'1. Pre-Pandemia (2015-2019)'</span>
        <span style="color: #f43f5e;">WHEN</span> Ano <span style="color: #f43f5e;">BETWEEN</span> 2020 <span style="color: #f43f5e;">AND</span> 2021 <span style="color: #f43f5e;">THEN</span> <span style="color: #a855f7;">'2. Pandemia (2020-2021)'</span>
        <span style="color: #f43f5e;">ELSE</span> <span style="color: #a855f7;">'3. Pos-Pandemia (2022-2025)'</span>
    <span style="color: #f43f5e;">END</span> <span style="color: #f43f5e;">AS</span> fase_epidemiologica,
    <span style="color: #38bdf8;">ROUND</span>(<span style="color: #38bdf8;">AVG</span>(Doadores_Efetivos_N), 0) <span style="color: #f43f5e;">AS</span> media_anual_doadores,
    <span style="color: #38bdf8;">ROUND</span>(<span style="color: #38bdf8;">AVG</span>(Tx_Total_Geral_N), 0) <span style="color: #f43f5e;">AS</span> media_anual_transplantes,
    <span style="color: #38bdf8;">ROUND</span>(<span style="color: #38bdf8;">AVG</span>(Lista_Mortalidade_Anual_Total), 0) <span style="color: #f43f5e;">AS</span> obitos_fila_por_ano
<span style="color: #f43f5e;">FROM</span> <span style="color: #a855f7;">'rbt_painel_uf_consolidado.parquet'</span>
<span style="color: #f43f5e;">WHERE</span> UF_Sigla = <span style="color: #a855f7;">'BR'</span>
<span style="color: #f43f5e;">GROUP BY</span> fase_epidemiologica
<span style="color: #f43f5e;">ORDER BY</span> fase_epidemiologica;`,

      'tab-powerbi': `<span style="color: #64748b;">// Power Query (Linguagem M) para importação direta no Power BI</span>
<span style="color: #f43f5e;">let</span>
    Source = Parquet.Document(File.Contents(<span style="color: #a855f7;">"c:\\...\\rbt_painel_uf_consolidado.parquet"</span>)),
    FiltradoSemBR = Table.SelectRows(Source, <span style="color: #f43f5e;">each</span> ([UF_Sigla] <> <span style="color: #a855f7;">"BR"</span>)),
    TiposAjustados = Table.TransformColumnTypes(FiltradoSemBR,{
        {<span style="color: #a855f7;">"Ano"</span>, Int64.Type},
        {<span style="color: #a855f7;">"UF_Sigla"</span>, type text},
        {<span style="color: #a855f7;">"Doadores_Efetivos_PMP"</span>, type number},
        {<span style="color: #a855f7;">"Tx_Total_Geral_N"</span>, Int64.Type}
    })
<span style="color: #f43f5e;">in</span>
    TiposAjustados`
    };

    Object.keys(tabs).forEach(tabId => {
      const tabBtn = document.getElementById(tabId);
      if (tabBtn) {
        tabBtn.addEventListener('click', () => {
          document.querySelectorAll('.code-tab-btn').forEach(b => b.classList.remove('active'));
          tabBtn.classList.add('active');
          codeBox.innerHTML = tabs[tabId];
        });
      }
    });

    document.getElementById('btn-copy-code').addEventListener('click', () => {
      navigator.clipboard.writeText(codeBox.innerText);
      const copyBtn = document.getElementById('btn-copy-code');
      const originalHtml = copyBtn.innerHTML;
      copyBtn.innerHTML = '<span>Copiado com Sucesso!</span>';
      copyBtn.style.color = '#34d399';
      setTimeout(() => {
        copyBtn.innerHTML = originalHtml;
        copyBtn.style.color = '';
      }, 2000);
    });

    // Organ Chart View Toggle (Bars vs Doughnut)
    const btnViewBars = document.getElementById('btn-view-bars');
    const btnViewDonut = document.getElementById('btn-view-donut');
    if (btnViewBars && btnViewDonut) {
      btnViewBars.addEventListener('click', () => {
        if (state.organChartType === 'bar') return;
        state.organChartType = 'bar';
        btnViewBars.classList.add('active');
        btnViewDonut.classList.remove('active');
        renderOrganChart();
      });

      btnViewDonut.addEventListener('click', () => {
        if (state.organChartType === 'doughnut') return;
        state.organChartType = 'doughnut';
        btnViewDonut.classList.add('active');
        btnViewBars.classList.remove('active');
        renderOrganChart();
      });
    }

    // Export CSV
    document.getElementById('btn-export-csv').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = 'rbt_painel_uf_consolidado.csv';
      a.download = 'rbt_painel_uf_consolidado.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  // Bootstrap Application
  initMap();
  initCharts();
  updateKPICards();
  updateRanking();
  setupEvents();
});
