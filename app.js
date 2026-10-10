(() => {
  'use strict';
  const data = window.AUDIAE_DATA;
  const $ = selector => document.querySelector(selector);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const state = {domain: 'sound', dataset: '', active: null, volume: .75, muted: false, pending: 0, loop: false, baselines: {}, segment: null, detailSeek: 0};
  const allCases = [...data.reconstruction, ...Object.values(data.generation).flat()];
  const modelsBySource = new Map(allCases.flatMap(example => [...(example.reference ? [example.reference] : []), ...example.models].map(model => [model.src, model])));
  let messageTimer;
  const mediaObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const audio = entry.target;
      if (!entry.isIntersecting || !audio.getClientRects().length) return;
      audio.preload = 'metadata';
      if (audio.readyState === 0 && audio.paused) audio.load();
      drawTrack(audio.closest('.track').querySelector('canvas'));
      mediaObserver.unobserve(audio);
    });
  }, {rootMargin: '120px 0px'});

  function notify(text) {
    const node = $('#playback-message');
    node.textContent = text;
    node.classList.add('visible');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => node.classList.remove('visible'), 3500);
  }

  function clearPlayers(root) {
    root.querySelectorAll('audio').forEach(audio => mediaObserver.unobserve(audio));
    if (state.active && root.contains(state.active)) {
      state.active.pause();
      state.active = null;
      state.detailSeek++;
      state.pending++;
    }
  }

  function track(model, group) {
    const ours = /^AuDiAE/.test(model.label);
    const label = model.label;
    return `<div class="track${ours ? ' ours' : ''}"><div class="track-heading"><h4>${escape(label)}</h4><span>${escape(model.note || '')}</span></div><canvas class="track-waveform" aria-label="${escape(label)} waveform"></canvas><audio controls preload="none" src="${escape(model.src)}" data-model="${escape(model.id)}" data-group="${escape(group)}" aria-label="${escape(label)} — ${escape(group)}"></audio></div>`;
  }

  function drawTrack(canvas) {
    if (!canvas || !canvas._model) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    const ctx = canvas.getContext('2d'), wave = canvas._model.wave;
    const progress = canvas._audio.currentTime / canvas._model.duration;
    const step = canvas.width / wave.length;
    const ours = canvas.closest('.track').classList.contains('ours');
    wave.forEach((peak, index) => {
      const height = Math.max(scale, peak * canvas.height * .93);
      ctx.fillStyle = index / wave.length < progress ? '#843e4b' : ours ? '#b88b8c' : '#b9b3aa';
      ctx.fillRect(index * step, (canvas.height - height) / 2, Math.max(scale, step * .58), height);
    });
    if (progress > 0) {
      ctx.fillStyle = '#843e4b';
      ctx.fillRect(Math.min(canvas.width - scale, progress * canvas.width), 0, scale, canvas.height);
    }
  }

  function drawTracks() { document.querySelectorAll('.track-waveform').forEach(drawTrack); }

  function wirePlayers(root) {
    root.querySelectorAll('audio').forEach(audio => {
      const canvas = audio.closest('.track').querySelector('canvas');
      canvas._audio = audio;
      canvas._model = modelsBySource.get(audio.getAttribute('src'));
      audio.volume = state.volume;
      audio.muted = state.muted;
      audio.loop = state.loop;
      audio.addEventListener('play', () => {
        if (state.segment && state.segment.group !== audio.dataset.group) state.segment = null;
        const previous = state.active;
        const paired = data.reconstruction.some(example => example.id === audio.dataset.group);
        const sync = paired && $('#sync-position').checked && previous && previous !== audio &&
          previous.dataset.group === audio.dataset.group && !previous.ended && previous.currentTime > 0;
        const position = sync ? previous.currentTime : null;
        document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
        const version = ++state.pending;
        state.active = audio;
        document.querySelectorAll('.track').forEach(node => node.classList.toggle('playing', node.contains(audio)));
        if (position !== null) {
          const seek = () => { if (state.active === audio && version === state.pending) audio.currentTime = Math.min(position, Math.max(0, audio.duration - .03)); };
          if (audio.readyState >= 1) seek();
          else audio.addEventListener('loadedmetadata', seek, {once: true});
        }
      });
      audio.addEventListener('pause', () => audio.closest('.track').classList.remove('playing'));
      audio.addEventListener('timeupdate', () => {
        if (state.active === audio && state.segment && state.segment.group === audio.dataset.group && audio.currentTime >= state.segment.end) audio.currentTime = state.segment.start;
        drawTrack(canvas);
      });
      audio.addEventListener('loadedmetadata', () => drawTrack(canvas));
      audio.addEventListener('volumechange', () => {
        if (audio.volume === state.volume && audio.muted === state.muted) return;
        state.volume = audio.volume;
        state.muted = audio.muted;
        document.querySelectorAll('audio').forEach(other => {
          if (other.volume !== state.volume) other.volume = state.volume;
          if (other.muted !== state.muted) other.muted = state.muted;
        });
      });
      audio.addEventListener('error', () => notify('This recording could not be loaded.'));
      mediaObserver.observe(audio);
    });
    root.querySelectorAll('details').forEach(details => details.addEventListener('toggle', drawTracks));
    requestAnimationFrame(drawTracks);
  }

  function selectExample(id) {
    const example = data.reconstruction.find(item => item.id === id);
    const root = $('#reconstruction-example');
    clearPlayers(root);
    const primaryIds = ['reference', 'ours_2048', 'ours_4096', 'same_l', 'sao', 'codicodec', 'ear2'];
    const primary = primaryIds.map(key => example.models.find(model => model.id === key)).filter(Boolean);
    const additional = example.models.filter(model => !primaryIds.includes(model.id));
    const baselines = example.models.filter(model => !['reference', 'ours_2048', 'ours_4096'].includes(model.id));
    const selectedBaseline = state.baselines[id] || example.spectra.defaultBaseline;
    root.innerHTML = `<div class="recording-heading"><h3>${escape(example.title)}</h3><span class="duration">${example.duration.toFixed(1)} s</span></div>${example.description ? `<p class="recording-caption">${escape(example.description)}</p>` : ''}<div class="compare-controls"><span>Compare</span><button type="button" data-play-model="reference">Reference</button><button type="button" data-play-model="ours_2048">AuDiAE</button><button type="button" data-play-model="ours_4096">AuDiAE-H</button><select class="audio-baseline-select" aria-label="Playback baseline">${baselines.map(m => `<option value="${escape(m.id)}"${m.id === selectedBaseline ? ' selected' : ''}>${escape(m.label)}</option>`).join('')}</select><button type="button" data-play-baseline>Play baseline</button><button type="button" data-restart>Restart</button><label><input type="checkbox" data-loop${state.loop ? ' checked' : ''}> Loop</label></div>${example.highlight ? `<div class="detail-listen-controls highlight-controls"><span>Loop ${example.highlight[0].toFixed(1)}–${example.highlight[1].toFixed(1)} s</span>${primary.map(m => `<button type="button" data-highlight-model="${escape(m.id)}">${escape(m.label)}</button>`).join('')}<button type="button" data-highlight-full>Full clip</button></div>` : ''}<div class="track-grid">${primary.map(model => track(model, example.id)).join('')}</div>${additional.length ? `<details class="additional-models"><summary>Additional baselines (${additional.length})</summary><div class="track-grid">${additional.map(model => track(model, example.id)).join('')}</div></details>` : ''}`;
    $('#example-select').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.example === id)));
    wirePlayers(root);
    renderReconstructionSpectra(example);
    const play = key => {
      if (!primaryIds.includes(key)) root.querySelector('.additional-models').open = true;
      const audio = root.querySelector(`audio[data-model="${key}"]`);
      audio.play().catch(error => { if (error.name !== 'AbortError') notify('This recording could not be played.'); });
    };
    root.querySelectorAll('[data-play-model]').forEach(button => button.addEventListener('click', () => play(button.dataset.playModel)));
    root.querySelector('[data-play-baseline]').addEventListener('click', () => play(root.querySelector('.audio-baseline-select').value));
    root.querySelector('.audio-baseline-select').addEventListener('change', event => updateComparisonBaseline(example, event.target.value));
    root.querySelectorAll('[data-highlight-model]').forEach(button => button.addEventListener('click', () => {
      const [start, end] = example.highlight;
      const audio = root.querySelector(`audio[data-model="${button.dataset.highlightModel}"]`);
      document.querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); });
      state.active = null;
      state.segment = {group: example.id, start, end};
      const seek = () => { if (audio.currentTime < start || audio.currentTime >= end) audio.currentTime = start; };
      if (audio.readyState > 0) seek(); else audio.addEventListener('loadedmetadata', seek, {once: true});
      audio.play().catch(() => notify('This recording could not be played.'));
    }));
    const fullClip = root.querySelector('[data-highlight-full]');
    if (fullClip) fullClip.addEventListener('click', () => { state.segment = null; });
    root.querySelector('[data-restart]').addEventListener('click', () => {
      state.segment = null;
      root.querySelectorAll('audio').forEach(a => { if (a.readyState > 0) a.currentTime = 0; });
      drawTracks();
    });
    root.querySelector('[data-loop]').addEventListener('change', event => {
      state.loop = event.target.checked;
      document.querySelectorAll('audio').forEach(a => { a.loop = state.loop; });
    });
  }

  function spectrumFigure(src, caption, alt, kind = '') {
    return `<figure class="spectrum-figure"${kind ? ` data-figure-kind="${kind}"` : ''}><figcaption>${escape(caption)}</figcaption><button type="button" class="figure-zoom" aria-label="Enlarge ${escape(caption)}"><img class="spectrum-image" src="${escape(src)}" alt="${escape(alt)}" loading="lazy"><span class="zoom-label">Enlarge</span></button></figure>`;
  }

  function updateComparisonBaseline(example, baseline) {
    state.baselines[example.id] = baseline;
    const card = document.querySelector(`.comparison-case[data-case="${example.id}"]`);
    if (!card) return;
    const figures = example.spectra.baselines[baseline];
    card.querySelector('select').value = baseline;
    for (const key of ['spectrum', 'difference']) {
      const img = card.querySelector(`[data-figure-kind="${key}"] img`);
      img.src = figures[key];
      img.alt = `${example.title}: Reference, AuDiAE, AuDiAE-H and ${figures.label}; ${key === 'spectrum' ? 'spectrogram' : 'signed level difference to Reference'}`;
    }
    const root = $('#reconstruction-example');
    if (root.querySelector('audio').dataset.group === example.id) root.querySelector('.audio-baseline-select').value = baseline;
  }

  function renderReconstructionSpectra(example) {
    const examples = data.reconstruction.filter(item => item.domain === state.domain && (state.dataset === 'All datasets' || item.dataset === state.dataset));
    const next = examples[(examples.findIndex(item => item.id === example.id) + 1) % examples.length];
    const pair = next.id === example.id ? [example] : [example, next];
    $('#reconstruction-spectra').innerHTML = `<h3>Spectrogram Comparison</h3>${pair.map(item => {
      const key = state.baselines[item.id] || item.spectra.defaultBaseline;
      const figures = item.spectra.baselines[key];
      const alt = `${item.title}: Reference, AuDiAE, AuDiAE-H and ${figures.label}`;
      const overview = item.spectra.overview;
      const allModels = `${item.title}: Reference, AuDiAE, AuDiAE-H, SAME-L, Stable Audio Open and CoDiCodec; spectrograms and signed level differences`;
      const mainFigure = overview ? spectrumFigure(overview.src, 'Spectrogram and level difference from Reference', allModels, 'overview') : spectrumFigure(figures.spectrum, 'Spectrogram', alt + '; spectrogram');
      return `<article class="comparison-case" data-case="${escape(item.id)}"><div class="comparison-heading"><h4>${escape(item.title)} <span>${item.duration.toFixed(1)} s${item.highlight ? ` · dashed box ${item.highlight[0].toFixed(1)}–${item.highlight[1].toFixed(1)} s${item.highlightBand ? `, below ${item.highlightBand[1]} kHz` : ''}` : ''}</span></h4><button type="button" data-listen-case="${escape(item.id)}">Listen</button></div>${mainFigure}<details class="additional-spectrum-comparisons"><summary>More comparisons</summary><div class="comparison-extra-controls"><label>Baseline <select aria-label="Spectrogram baseline for ${escape(item.title)}">${Object.entries(item.spectra.baselines).map(([id, v]) => `<option value="${escape(id)}"${id === key ? ' selected' : ''}>${escape(v.label)}</option>`).join('')}</select></label></div><div class="figure-pair">${spectrumFigure(figures.spectrum, 'Spectrogram', alt + '; spectrogram', 'spectrum')}${spectrumFigure(figures.difference, 'Level difference from Reference', alt + '; signed level difference to Reference', 'difference')}</div></details></article>`;
    }).join('')}`;
    $('#reconstruction-spectra').querySelectorAll('.comparison-case').forEach(card => {
      const item = data.reconstruction.find(x => x.id === card.dataset.case);
      card.querySelector('select').addEventListener('change', event => updateComparisonBaseline(item, event.target.value));
      card.querySelector('[data-listen-case]').addEventListener('click', () => {
        selectExample(item.id);
        $('#reconstruction-example').scrollIntoView({behavior: 'smooth', block: 'start'});
      });
    });
  }

  function selectDataset(name) {
    state.dataset = name;
    const examples = data.reconstruction.filter(item => item.domain === state.domain && (name === 'All datasets' || item.dataset === name));
    $('#example-select').innerHTML = examples.map((example, index) => `<button type="button" data-example="${escape(example.id)}" aria-label="Example ${index + 1}" title="Example ${index + 1}" aria-pressed="${index === 0}">${String(index + 1).padStart(2, '0')}</button>`).join('');
    $('#example-select').querySelectorAll('button').forEach(button => button.addEventListener('click', () => selectExample(button.dataset.example)));
    selectExample(examples[0].id);
  }

  function selectDomain(domain) {
    state.domain = domain;
    $('#domain-tabs').querySelectorAll('button').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.domain === domain));
      const kind = button.dataset.domain;
      button.textContent = kind[0].toUpperCase() + kind.slice(1);
    });
    const datasets = [...new Set(data.reconstruction.filter(item => item.domain === domain).map(item => item.dataset))];
    $('#dataset-select').innerHTML = '<option>All datasets</option>' + datasets.map(name => `<option>${escape(name)}</option>`).join('');
    selectDataset('All datasets');
  }

  function examplesMarkup(examples) {
    return examples.map((example, index) => {
      const region = example.visuals?.detailRegion;
      const comparisonModels = [example.reference, ...example.models];
      const controls = region ? `<div class="detail-listen-controls"><span>Loop ${region[0].toFixed(1)}–${region[1].toFixed(1)} s</span>${comparisonModels.map(m => `<button type="button" data-detail-model="${escape(m.id)}" data-detail-case="${escape(example.id)}">${escape(m.label)}</button>`).join('')}<button type="button" data-full-clip="${escape(example.id)}">Full clip</button></div>` : '';
      const figure = example.visuals ? `<details class="spectrum-panel"><summary>Spectrogram comparison</summary><div class="spectrum-prompt"><span>Text prompt</span><p>${escape(example.prompt)}</p></div>${controls}<div class="generation-figure">${spectrumFigure(example.visuals.spectrum, 'Full-clip spectrograms', 'Dataset reference, AuDiAE, AuDiAE-H and baselines; full-clip spectrograms for ' + example.prompt)}</div></details>` : '';
      return `<article class="example"><p class="prompt"><span class="example-number">${String(index + 1).padStart(2, '0')}</span><span><span class="prompt-label">Text prompt</span>${escape(example.prompt)}</span></p><div class="generation-reference">${track(example.reference, example.id)}</div><div class="track-grid">${example.models.map(model => track(model, example.id)).join('')}</div>${figure}</article>`;
    }).join('');
  }

  function cells(row, columns) {
    if ('group' in row) return row.group ? `<tr class="group-row"><th scope="colgroup" colspan="${columns}">${escape(row.group)}</th></tr>` : `<tr class="divider-row"><td colspan="${columns}"></td></tr>`;
    return `<tr class="${row.ours ? 'ours' : ''}">${row.cells.map((cell, index) => `<td${index === 0 ? ' class="model-name"' : ''}>${cell.bold ? `<strong>${escape(cell.text)}</strong>` : escape(cell.text)}</td>`).join('')}</tr>`;
  }


  function resultTable(caption, header, rows) {
    return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(caption)}"><table><caption>${escape(caption)}</caption><thead>${header}</thead><tbody>${rows.map(row => cells(row, rows.find(r => r.cells).cells.length)).join('')}</tbody></table></div>`;
  }

  function showResults(kind) {
    $('#result-tabs').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.result === kind)));
    if (kind === 'controlled') {
      $('#result-table').innerHTML = `<div class="table-stack">${resultTable('Table 3(a). Rate-model control on the AudioCaps test set.', '<tr class="grouped"><th scope="col" rowspan="2">Rate objective</th><th scope="colgroup" colspan="4">Reconstruction</th><th scope="colgroup" colspan="2">Generation</th></tr><tr><th scope="col">MEL ↓</th><th scope="col">STFT ↓</th><th scope="col">SI-SDR ↑</th><th scope="col">rFAD ↓</th><th scope="col">FAD ↓</th><th scope="col">CLAP ↑</th></tr>', data.tables.controlled.a)}${resultTable('Table 3(b). Text-conditional rate on the AudioCaps test set.', '<tr><th scope="col">Rate objective</th><th scope="col">FAD ↓</th><th scope="col">CLAP ↑</th></tr>', data.tables.controlled.b)}</div><p class="note">Panel (a) compares the fixed-Gaussian rate with the learned unconditional diffusion rate under the same endpoint channel and training contract. Panel (b) compares unconditional, shuffled-caption and paired-caption diffusion-rate objectives. All distributional metrics use LAION-CLAP.</p>`;
      return;
    }
    const specification = {
      reconstruction: {
        caption: 'Table 1. Audio reconstruction on sound and music benchmarks.',
        header: '<tr class="grouped"><th scope="col" rowspan="2">Autoencoder</th><th scope="col" rowspan="2">Temporal compression</th><th scope="colgroup" colspan="3">Sound avg.</th><th scope="colgroup" colspan="3">Music avg.</th><th scope="col" rowspan="2">rFAD ↓</th><th scope="col" rowspan="2">MOS ↑</th></tr><tr><th scope="col">SI-SDR ↑</th><th scope="col">STFT ↓</th><th scope="col">MEL ↓</th><th scope="col">SI-SDR ↑</th><th scope="col">STFT ↓</th><th scope="col">MEL ↓</th></tr>',
        note: 'Sound and music metrics are dataset-macro averages. rFAD averages AudioCaps and Song Describer in CLAP audio space. MOS: mean ± standard deviation over 60 item-level scores, each averaging five listener ratings. Compression factors and native decoders differ across systems.'
      },
      generation: {
        caption: 'Table 2. Text-to-audio generation on the AudioCaps test set.',
        header: '<tr><th scope="col">Autoencoder</th><th scope="col">FAD ↓</th><th scope="col">CLAP ↑</th></tr>',
        note: 'Each frozen autoencoder is paired with the same generator family. Prompts, sampling and evaluation are fixed across rows. FAD uses CLAP embeddings.'
      }
    }[kind];
    $('#result-table').innerHTML = `${resultTable(specification.caption, specification.header, data.tables[kind])}<p class="note">${escape(specification.note)}</p>`;
  }

  $('#domain-tabs').querySelectorAll('button').forEach(button => button.addEventListener('click', () => selectDomain(button.dataset.domain)));
  $('#dataset-select').addEventListener('change', event => selectDataset(event.target.value));
  $('#result-tabs').querySelectorAll('button').forEach(button => button.addEventListener('click', () => showResults(button.dataset.result)));
  document.querySelectorAll('[data-result-link]').forEach(link => link.addEventListener('click', () => showResults(link.dataset.resultLink)));
  selectDomain('sound');
  $('#sound-generation').innerHTML = examplesMarkup(data.generation.sound);
  wirePlayers($('#sound-generation'));
  showResults('reconstruction');
  const dialog = $('#figure-dialog');
  document.addEventListener('click', event => {
    const segmentButton = event.target.closest('[data-detail-model], [data-full-clip]');
    if (segmentButton) {
      const id = segmentButton.dataset.detailCase || segmentButton.dataset.fullClip;
      const example = Object.values(data.generation).flat().find(x => x.id === id);
      const root = segmentButton.closest('.example');
      const key = segmentButton.dataset.detailModel || (state.active && root.contains(state.active) ? state.active.dataset.model : example.models[0].id);
      const audio = root.querySelector(`audio[data-model="${key}"]`);
      document.querySelectorAll('audio').forEach(a => a.pause());
      state.active = null;
      const seekRequest = ++state.detailSeek;
      const region = example.visuals.detailRegion;
      state.segment = segmentButton.dataset.detailModel ? {group:id,start:region[0],end:region[1]} : null;
      const position = state.segment ? region[0] : 0;
      if (audio.readyState > 0) audio.currentTime = position;
      else audio.addEventListener('loadedmetadata', () => { if (state.active === audio && state.detailSeek === seekRequest) audio.currentTime = position; }, {once:true});
      audio.play().catch(error => { if (error.name !== 'AbortError') notify('This recording could not be played.'); });
      return;
    }
    const button = event.target.closest('.figure-zoom');
    if (!button) return;
    const source = button.querySelector('img');
    dialog.querySelector('img').src = source.src;
    dialog.querySelector('img').alt = source.alt;
    $('#figure-dialog-title').textContent = source.alt;
    dialog.showModal();
  });
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { drawTracks(); }, 100); });
})();
