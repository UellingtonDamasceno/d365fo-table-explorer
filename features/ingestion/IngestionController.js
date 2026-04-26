/* =====================================================================
   features/ingestion/IngestionController.js
   Orquestração do processo de importação e carga inicial
   ===================================================================== */
'use strict';

const IngestionController = {
  /**
   * Inicializa o estado a partir do IndexedDB.
   */
  async initializeFromDB(callbacks) {
    const { showOverlay, hideOverlay, setLoading, resetProgress, initApp } = callbacks;
    
    showOverlay();
    resetProgress();

    if (window.D365MetadataDB?.isSupported?.()) {
      try {
        window.D365MetadataDB.init();
        const count = await window.D365MetadataDB.countTables();
        if (count > 0) {
          setLoading(`Carregando metadados locais (${count.toLocaleString()} tabelas)...`);
          const tables = await window.D365MetadataDB.getAllTables();
          const info = await window.D365MetadataDB.getImportInfo();
          initApp({ tables, info });
          hideOverlay();
          return true;
        }
      } catch (err) {
        console.warn('Falha ao carregar IndexedDB local:', err);
      }
    }

    setLoading('Banco de dados vazio. Importe a pasta PackagesLocalDirectory.');
    return false;
  },

  /**
   * Executa o fluxo completo de importação de diretório.
   */
  async importFromDirectory(callbacks) {
    const { setLoading, setProgress, initApp, hideOverlay } = callbacks;

    if (!window.D365Ingestion?.supportsDirectoryImport?.()) {
      alert('Este navegador não suporta importação por pasta.');
      return;
    }

    try {
      setLoading('Solicitando acesso à pasta...');
      if (window.D365MetadataDB?.isSupported?.()) {
        window.D365MetadataDB.init();
        await window.D365MetadataDB.ensureStoragePersistence();
      }

      const rootHandle = await window.showDirectoryPicker({ mode: 'read' });
      const tStartTotal = performance.now();

      setLoading('Varrendo arquivos XML...');
      const tStartScan = performance.now();
      const scan = await window.D365Ingestion.collectXmlFiles(rootHandle, {
        onProgress: (p) => setProgress(p),
      });
      const tEndScan = performance.now();

      if (!scan.files.length) {
        setLoading('Nenhum XML de AxTable foi encontrado.');
        return;
      }

      setLoading(`Processando ${scan.files.length.toLocaleString()} arquivos...`);
      const parsed = await window.D365Ingestion.processFiles(scan.files, {
        onProgress: (p) => setProgress(p),
      });
      
      setLoading('Finalizando metadados...');
      setProgress({ phase: 'finalize' });

      if (window.D365MetadataDB?.isSupported?.()) {
        await window.D365MetadataDB.saveImport({
          tables: parsed.tables,
          extensions: parsed.extensions,
          stats: { durationMs: performance.now() - tStartTotal }
        });
      }

      const tEndTotal = performance.now();
      const totalTimeSec = ((tEndTotal - tStartTotal) / 1000).toFixed(2);
      
      const telemetry = {
        totalTimeSec,
        fileCount: scan.files.length,
        tableCount: parsed.tables.length,
        fieldCount: parsed.stats?.totalFields || 0,
        workerMetrics: parsed.stats?.workerMetrics || [],
        scanTimeMs: tEndScan - tStartScan,
        parseTimeMs: tEndTotal - tEndScan
      };

      setProgress({ 
        phase: 'done', 
        message: `Sucesso: ${parsed.tables.length.toLocaleString()} tabelas em ${totalTimeSec}s` 
      });

      initApp({ tables: parsed.tables, telemetry });
      hideOverlay();
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Falha na importação:', err);
      setLoading(`❌ Falha: ${err.message}`);
    }
  }
};

window.D365IngestionController = IngestionController;