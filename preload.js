const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getKeywordHistory: (channelConfig) => ipcRenderer.invoke('get-keyword-history', channelConfig),
  loadKeywordData: (channelConfig, keyword) => ipcRenderer.invoke('load-keyword-data', channelConfig, keyword),
  getKeywordCrawlDate: (channelConfig, keyword) => ipcRenderer.invoke('get-keyword-crawl-date', channelConfig, keyword),
  deleteKeywordData: (channelConfig, keyword) => ipcRenderer.invoke('delete-keyword-data', channelConfig, keyword),
  deleteDocumentById: (channelConfig, docId) => ipcRenderer.invoke('delete-document-by-id', channelConfig, docId),
  updateDocumentPick: (channelConfig, docId, pick) => ipcRenderer.invoke('update-document-pick', channelConfig, docId, pick),
  getChannels: () => ipcRenderer.invoke('get-channels'),
  addChannel: (doc) => ipcRenderer.invoke('add-channel', doc),
  isKeywordsCollectionTaken: (keywordsCollection) =>
    ipcRenderer.invoke('is-keywords-collection-taken', keywordsCollection),
  runCrawl: (opts) => ipcRenderer.invoke('run-crawl', opts),
});
