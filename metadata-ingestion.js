/* Browser-native metadata ingestion pipeline */
(function () {
  const AX_FOLDER_RX = /^AxTable(Extension)?$/i;
  const WORKER_URL = 'metadata-worker.js?v=20260411a';

  function supportsDirectoryImport() {
    return typeof window.showDirectoryPicker === 'function' && typeof Worker !== 'undefined';
  }

  function deriveContextFromPath(path) {
    const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
    
    // 1. Procurar a pasta AxTable ou AxTableExtension no caminho
    const axIndex = parts.findIndex(p => AX_FOLDER_RX.test(p));
    
    // Se não houver uma pasta de tabela no caminho, ignore o arquivo (mesma lógica do -match do PS)
    if (axIndex < 0) return { isRelevant: false };

    // 2. Filtro de Segurança: Ignorar metadados compilados, binários ou fontes X++
    const hasSystemPart = parts.some(p => /^(xppmetadata|bin|xppsource|buildproject|descriptor|resources|reports|webfiles)$/i.test(p));
    if (hasSystemPart) return { isRelevant: false };

    const axFolder = parts[axIndex];
    const isExtension = /Extension$/i.test(axFolder);
    
    // 3. Identificar o Modelo (pasta pai do AxTable ou pai do Delta)
    let model = 'Unknown';
    if (axIndex > 0) {
      let prev = parts[axIndex - 1];
      // Estrutura comum: <Model>/<Model>/AxTable ou <Model>/<Model>/Delta/AxTable
      if (prev.toLowerCase() === 'delta' && axIndex > 1) {
        model = parts[axIndex - 2];
      } else {
        model = prev;
      }
    }

    return {
      isRelevant: true,
      isExtension,
      model,
      axFolder,
    };
  }

  async function collectXmlFiles(rootHandle, options = {}) {
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const files = [];
    const stats = { phase: 'scan', dirs: 0, scannedFiles: 0, matchedFiles: 0 };

    async function walk(dirHandle, pathParts) {
      stats.dirs += 1;
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind === 'directory') {
          // OTIMIZAÇÃO: Ignorar pastas AOT irrelevantes (AxClass, AxForm, etc)
          const isAotFolder = /^ax[a-z0-9]+$/i.test(name);
          const isTarget = AX_FOLDER_RX.test(name);
          
          if (isAotFolder && !isTarget) continue;

          // Ignorar pastas de sistema que nunca contêm definições de tabelas fonte
          if (/^(xppmetadata|bin|buildproject|xppsource|descriptor|resources|reports|webfiles)$/i.test(name)) continue;

          await walk(handle, [...pathParts, name]);
          continue;
        }

        stats.scannedFiles += 1;
        
        // Só processamos XMLs
        if (!name.toLowerCase().endsWith('.xml')) {
          if (onProgress && stats.scannedFiles % 500 === 0) onProgress({ ...stats });
          continue;
        }

        const relPath = [...pathParts, name].join('/');
        const ctx = deriveContextFromPath(relPath);

        if (ctx.isRelevant) {
          files.push({ handle, path: relPath });
          stats.matchedFiles += 1;
        }

        if (onProgress && (stats.matchedFiles % 100 === 0 || stats.scannedFiles % 500 === 0)) {
          onProgress({ ...stats });
        }
      }
    }

    await walk(rootHandle, [rootHandle.name || 'PackagesLocalDirectory']);
    if (onProgress) onProgress({ ...stats, done: true });
    return { files, stats };
  }

  function splitPartitions(items, count) {
    const partitions = Array.from({ length: count }, () => []);
    items.forEach((item, idx) => partitions[idx % count].push(item));
    return partitions;
  }

  function relationKey(rel) {
    const constraints = Array.isArray(rel?.constraints) ? rel.constraints : [];
    const cKey = constraints.map(c => `${c.field}=${c.relatedField}`).join('&');
    return `${rel?.name || ''}|${rel?.relatedTable || ''}|${cKey}`;
  }

  function ensureStringArray(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(x => String(x || '').trim()).filter(Boolean))];
  }

  function createAccumulatorTable(name) {
    return {
      name,
      tableGroup: 'None',
      model: '',
      models: new Set(),
      fields: [],
      relations: [],
      _fieldByName: new Map(),
      _relByKey: new Map(),
    };
  }

  function mergeSourceModels(targetObj, incomingObj, fallbackModel) {
    const incomingModels = ensureStringArray(incomingObj?.sourceModels);
    const existing = new Set(ensureStringArray(targetObj?.sourceModels));
    incomingModels.forEach(m => existing.add(m));
    if (!incomingModels.length && fallbackModel) existing.add(String(fallbackModel));
    targetObj.sourceModels = [...existing];
  }

  function mergeTables(acc, incomingTables) {
    incomingTables.forEach(src => {
      if (!src?.name) return;
      if (!acc.has(src.name)) acc.set(src.name, createAccumulatorTable(src.name));
      const dst = acc.get(src.name);

      if (src.tableGroup && src.tableGroup !== 'None' && dst.tableGroup === 'None') dst.tableGroup = src.tableGroup;
      if (src.model && !dst.model) dst.model = src.model;
      ensureStringArray(src.models).forEach(m => dst.models.add(m));
      if (src.model) dst.models.add(src.model);

      (src.fields || []).forEach(field => {
        const name = String(field?.name || '');
        if (!name) return;
        const k = name.toLowerCase();
        const existing = dst._fieldByName.get(k);
        if (!existing) {
          const copy = {
            name,
            type: String(field?.type || ''),
            extendedDataType: String(field?.extendedDataType || ''),
            enumType: String(field?.enumType || ''),
            sourceModels: [],
          };
          mergeSourceModels(copy, field, src.model);
          dst.fields.push(copy);
          dst._fieldByName.set(k, copy);
          return;
        }
        if (!existing.type && field.type) existing.type = String(field.type);
        if (!existing.extendedDataType && field.extendedDataType) existing.extendedDataType = String(field.extendedDataType);
        if (!existing.enumType && field.enumType) existing.enumType = String(field.enumType);
        mergeSourceModels(existing, field, src.model);
      });

      (src.relations || []).forEach(rel => {
        if (!rel?.relatedTable) return;
        const key = relationKey(rel);
        const existing = dst._relByKey.get(key);
        if (!existing) {
          const copy = {
            name: String(rel?.name || ''),
            relatedTable: String(rel?.relatedTable || ''),
            cardinality: String(rel?.cardinality || ''),
            relatedTableCardinality: String(rel?.relatedTableCardinality || ''),
            relationshipType: String(rel?.relationshipType || ''),
            constraints: Array.isArray(rel?.constraints)
              ? rel.constraints
                  .map(c => ({
                    field: String(c?.field || ''),
                    relatedField: String(c?.relatedField || ''),
                  }))
                  .filter(c => c.field && c.relatedField)
              : [],
            sourceModels: [],
          };
          mergeSourceModels(copy, rel, src.model);
          dst.relations.push(copy);
          dst._relByKey.set(key, copy);
          return;
        }
        mergeSourceModels(existing, rel, src.model);
      });
    });
  }

  function mergeExtensions(acc, incomingExtensions) {
    incomingExtensions.forEach(ext => {
      const tableName = String(ext?.tableName || '');
      const model = String(ext?.model || '');
      if (!tableName || !model) return;
      const key = `${tableName}::${model}`;
      if (!acc.has(key)) {
        acc.set(key, {
          tableName,
          model,
          files: 0,
          fieldsAdded: 0,
          relationsAdded: 0,
        });
      }
      const dst = acc.get(key);
      dst.files += Number(ext?.files || 0);
      dst.fieldsAdded += Number(ext?.fieldsAdded || 0);
      dst.relationsAdded += Number(ext?.relationsAdded || 0);
    });
  }

  function finalizeTables(acc) {
    const out = [];
    acc.forEach(row => {
      const models = [...row.models].filter(Boolean).sort((a, b) => a.localeCompare(b));
      const model = row.model || models[0] || 'Unknown';
      const fields = row.fields.sort((a, b) => a.name.localeCompare(b.name));
      const relations = row.relations.sort((a, b) => {
        const cmp = a.relatedTable.localeCompare(b.relatedTable);
        return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '');
      });
      out.push({
        name: row.name,
        tableGroup: row.tableGroup || 'None',
        model,
        models: models.length ? models : [model],
        fields,
        relations,
        fieldNames: [...new Set(fields.map(f => f.name))],
        relatedTables: [...new Set(relations.map(r => r.relatedTable).filter(Boolean))],
      });
    });
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  function finalizeExtensions(acc) {
    return [...acc.values()].sort((a, b) => {
      const c1 = a.tableName.localeCompare(b.tableName);
      return c1 !== 0 ? c1 : a.model.localeCompare(b.model);
    });
  }

  function defaultWorkerCount() {
    const hc = navigator.hardwareConcurrency || 4;
    return Math.min(8, Math.max(1, hc - 1));
  }

  async function processFiles(files, options = {}) {
    if (!Array.isArray(files) || files.length === 0) {
      return {
        tables: [],
        extensions: [],
        stats: {
          phase: 'parse',
          workers: 0,
          totalFiles: 0,
          processedFiles: 0,
          errors: 0,
          durationMs: 0,
        },
      };
    }
    if (typeof Worker === 'undefined') throw new Error('Web Workers não suportados neste navegador.');

    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const workersCount = Math.min(Math.max(1, Number(options.workerCount || defaultWorkerCount())), files.length);
    const partitions = splitPartitions(files, workersCount);
    const workers = [];
    const startedAt = performance.now();

    const tableAcc = new Map();
    const extensionAcc = new Map();
    const workerState = Array.from({ length: workersCount }, () => ({ processed: 0, errors: 0, done: false }));
    let completedWorkers = 0;
    let settled = false;

    const reportProgress = () => {
      if (!onProgress) return;
      const processed = workerState.reduce((n, w) => n + w.processed, 0);
      const errors = workerState.reduce((n, w) => n + w.errors, 0);
      onProgress({
        phase: 'parse',
        processed,
        total: files.length,
        errors,
        workersDone: completedWorkers,
        workersTotal: workersCount,
      });
    };

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        workers.forEach(w => {
          try { w.terminate(); } catch (_) {}
        });
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        const durationMs = Math.round(performance.now() - startedAt);
        const tables = finalizeTables(tableAcc);
        const extensions = finalizeExtensions(extensionAcc);
        const processedFiles = workerState.reduce((n, w) => n + w.processed, 0);
        const errors = workerState.reduce((n, w) => n + w.errors, 0);
        resolve({
          tables,
          extensions,
          stats: {
            phase: 'parse',
            workers: workersCount,
            totalFiles: files.length,
            processedFiles,
            errors,
            durationMs,
          },
        });
      };

      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };

      partitions.forEach((partition, workerId) => {
        const worker = new Worker(WORKER_URL);
        workers.push(worker);

        worker.onmessage = (evt) => {
          const msg = evt.data || {};
          if (msg.type === 'progress') {
            workerState[workerId].processed = Number(msg.processed || 0);
            workerState[workerId].errors = Number(msg.errors || 0);
            reportProgress();
            return;
          }
          if (msg.type === 'error') {
            fail(new Error(msg.message || `Worker ${workerId} falhou.`));
            return;
          }
          if (msg.type === 'result') {
            workerState[workerId].processed = Number(msg.processed || 0);
            workerState[workerId].errors = Number(msg.errors || 0);
            workerState[workerId].done = true;
            mergeTables(tableAcc, Array.isArray(msg.tables) ? msg.tables : []);
            mergeExtensions(extensionAcc, Array.isArray(msg.extensions) ? msg.extensions : []);
            completedWorkers += 1;
            reportProgress();
            if (completedWorkers === workersCount) finish();
          }
        };

        worker.onerror = (err) => {
          fail(new Error(err?.message || `Worker ${workerId} gerou um erro não tratado.`));
        };

        worker.postMessage({
          type: 'parsePartition',
          workerId,
          files: partition,
        });
      });
    });
  }

  window.D365Ingestion = {
    supportsDirectoryImport,
    deriveContextFromPath,
    collectXmlFiles,
    processFiles,
  };
})();
