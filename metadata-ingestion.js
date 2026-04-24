/* Browser-native metadata ingestion pipeline */
(function () {
  const AX_FOLDER_RX = /^AxTable(Extension)?$/i;
  const WORKER_URL = 'metadata-worker.js?v=20260424h';

  const FOLDERS_TO_IGNORE = /^(AxClass|AxForm|AxQuery|AxReport|AxSecurityRole|AxSecurityDuty|AxSecurityPrivilege|AxSecurityPermission|AxMenu|AxMenuItem|AxLabel|AxTile|AxResource|AxEnum|AxEdt|AxWf|AxWorkflow|AxActionPane|AxFormExtension|bin|xppmetadata|descriptor|reports|resources|webfiles|buildproject)$/i;

  function supportsDirectoryImport() {
    return typeof window.showDirectoryPicker === 'function' && typeof Worker !== 'undefined';
  }

  function deriveContextFromPath(path) {
    const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
    const axIndex = parts.findIndex(p => AX_FOLDER_RX.test(p));
    if (axIndex < 0) return { isRelevant: false };
    if (parts.some(p => /^(bin|xppmetadata|buildproject)$/i.test(p))) return { isRelevant: false };

    const axFolder = parts[axIndex];
    let model = 'Unknown';
    if (axIndex > 0) {
      let prev = parts[axIndex - 1];
      if (prev.toLowerCase() === 'delta' && axIndex > 1) model = parts[axIndex - 2];
      else model = prev;
    }
    return { isRelevant: true, isExtension: /Extension$/i.test(axFolder), model };
  }

  async function collectXmlFiles(rootHandle, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const files = [];
    const stats = { phase: 'scan', dirs: 0, scannedFiles: 0, matchedFiles: 0 };
    const tStartScan = performance.now();

    async function walk(dirHandle, pathParts) {
      stats.dirs += 1;
      const tasks = [];
      try {
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'directory') {
            if (FOLDERS_TO_IGNORE.test(name)) continue;
            tasks.push(walk(handle, [...pathParts, name]));
          } else {
            stats.scannedFiles += 1;
            if (name.toLowerCase().endsWith('.xml')) {
              const relPath = [...pathParts, name].join('/');
              const ctx = deriveContextFromPath(relPath);
              if (ctx.isRelevant) {
                files.push({ handle, path: relPath });
                stats.matchedFiles += 1;
              }
            }
            // OTIMIZAÇÃO: UI Throttle (reduz o custo de atualizar a tela 1.6M de vezes)
            if (onProgress && (stats.matchedFiles % 1000 === 0 || stats.scannedFiles % 10000 === 0)) {
              onProgress({ ...stats });
            }
          }
        }
        if (tasks.length) await Promise.all(tasks);
      } catch (err) {
        console.warn(`[Ingestion] Pulo na pasta ${pathParts.join('/')}:`, err.message);
      }
    }
    await walk(rootHandle, [rootHandle.name || 'PackagesLocalDirectory']);
    const tEndScan = performance.now();
    if (onProgress) onProgress({ ...stats, done: true });
    return { files, stats: { ...stats, durationMs: tEndScan - tStartScan } };
  }

  function splitPartitions(items, count) {
    const partitions = Array.from({ length: count }, () => []);
    items.forEach((item, idx) => partitions[idx % count].push(item));
    return partitions;
  }

  function relationDedupKey(rel) {
    return (rel?.name || rel?.relatedTable || '').toLowerCase().trim();
  }

  function mergeTables(acc, incomingTables) {
    let fieldCount = 0;
    incomingTables.forEach(src => {
      if (!src?.name) return;
      if (!acc.has(src.name)) {
        acc.set(src.name, {
          name: src.name,
          tableGroup: 'None',
          model: src.model,
          models: new Set(),
          fields: [],
          relations: [],
          _f: new Set(),
          _r: new Set()
        });
      }
      const dst = acc.get(src.name);
      if (src.tableGroup && src.tableGroup !== 'None' && dst.tableGroup === 'None') dst.tableGroup = src.tableGroup;
      dst.models.add(src.model);

      (src.fields || []).forEach(f => {
        const k = f.name.toLowerCase();
        if (!dst._f.has(k)) {
          dst.fields.push(f);
          dst._f.add(k);
          fieldCount++;
        }
      });
      (src.relations || []).forEach(r => {
        const k = relationDedupKey(r);
        if (!dst._r.has(k)) {
          dst.relations.push(r);
          dst._r.add(k);
        }
      });
    });
    return fieldCount;
  }

  function mergeExtensions(acc, incomingExtensions) {
    incomingExtensions.forEach(ext => {
      if (!ext?.tableName || !ext?.model) return;
      const key = `${ext.tableName}::${ext.model}`;
      if (!acc.has(key)) {
        acc.set(key, { ...ext });
      } else {
        const dst = acc.get(key);
        dst.files += (ext.files || 0);
        dst.fieldsAdded += (ext.fieldsAdded || 0);
        dst.relationsAdded += (ext.relationsAdded || 0);
      }
    });
  }

  function finalizeTables(acc) {
    return Array.from(acc.values()).map(t => ({
      ...t,
      models: Array.from(t.models),
      fieldNames: t.fields.map(f => f.name),
      relatedTables: [...new Set(t.relations.map(r => r.relatedTable))]
    }));
  }

  async function processFiles(files, options = {}) {
    if (!files.length) return { tables: [], extensions: [], stats: {} };
    const onProgress = options.onProgress;
    const workersCount = Math.min(8, navigator.hardwareConcurrency || 4);
    const partitions = splitPartitions(files, workersCount);
    const tableAcc = new Map();
    const extensionAcc = new Map();
    const startedAt = performance.now();
    let totalProcessedAcrossWorkers = 0;
    let totalFieldsAcrossWorkers = 0;
    
    const workerMetrics = [];

    await Promise.all(partitions.map((batch, idx) => {
      return new Promise((resolve) => {
        const worker = new Worker(WORKER_URL);
        const tStartWorker = performance.now();
        
        worker.onmessage = (evt) => {
          const msg = evt.data || {};
          if (msg.type === 'batch_result' || msg.type === 'result') {
            totalFieldsAcrossWorkers += mergeTables(tableAcc, msg.tables || []);
            mergeExtensions(extensionAcc, msg.extensions || []);
            
            if (msg.type === 'batch_result') {
              totalProcessedAcrossWorkers += msg.processed;
              if (onProgress) onProgress({ phase: 'parse', processed: totalProcessedAcrossWorkers, total: files.length });
            } else if (msg.type === 'result') {
              const tEndWorker = performance.now();
              workerMetrics.push({
                workerId: idx,
                files: msg.processed,
                errors: msg.errors,
                totalMs: msg.metrics?.totalMs || (tEndWorker - tStartWorker),
                avgMs: msg.metrics?.avgMsPerFile || ((tEndWorker - tStartWorker) / msg.processed).toFixed(3)
              });
              worker.terminate();
              resolve();
            }
          }
        };
        worker.postMessage({ type: 'parsePartition', workerId: idx, files: batch });
      });
    }));

    const totalDuration = performance.now() - startedAt;

    return {
      tables: finalizeTables(tableAcc),
      extensions: Array.from(extensionAcc.values()),
      stats: { durationMs: totalDuration, workerMetrics, totalFields: totalFieldsAcrossWorkers }
    };
  }

  window.D365Ingestion = { supportsDirectoryImport, collectXmlFiles, processFiles };
})();
