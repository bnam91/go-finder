import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import './loadEnv.js';
import { getKeywordHistory, loadKeywordData, deleteKeywordData, deleteDocumentById, getKeywordCrawlDate, updateDocumentPick } from './modules/mongo.js';
import { getChannels, addChannel, isKeywordsCollectionTaken } from './utils/channelConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.env.ELECTRON_DEV === '1') {
  const require = createRequire(import.meta.url);
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron'),
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 개발 모드에서 시작 시 DevTools 자동 열기
  if (process.env.ELECTRON_DEV === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools();
    });
  }

  // F12로 DevTools 토글
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

ipcMain.handle('get-keyword-history', async (_, channelConfig) => {
  try {
    const keywords = channelConfig ? await getKeywordHistory(channelConfig) : [];
    return { ok: true, data: keywords };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('load-keyword-data', async (_, channelConfig, keyword) => {
  try {
    const data = channelConfig && keyword ? await loadKeywordData(channelConfig, keyword) : [];
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-keyword-crawl-date', async (_, channelConfig, keyword) => {
  try {
    const date = channelConfig && keyword ? await getKeywordCrawlDate(channelConfig, keyword) : null;
    return { ok: true, date };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-keyword-data', async (_, channelConfig, keyword) => {
  try {
    const result = await deleteKeywordData(channelConfig, keyword);
    return { ok: true, deletedCount: result.deletedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-document-by-id', async (_, channelConfig, docId) => {
  try {
    const result = await deleteDocumentById(channelConfig, docId);
    return { ok: true, deletedCount: result.deletedCount };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('update-document-pick', async (_, channelConfig, docId, pick) => {
  try {
    const result = await updateDocumentPick(channelConfig, docId, pick);
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('get-channels', async () => {
  try {
    const channels = await getChannels();
    return { ok: true, data: channels };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('add-channel', async (_, doc) => {
  try {
    await addChannel(doc);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('is-keywords-collection-taken', async (_, keywordsCollection) => {
  try {
    const taken = await isKeywordsCollectionTaken(keywordsCollection);
    return { ok: true, taken };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('run-crawl', async (_, opts) => {
  try {
    const { runCrawlWithConfig } = await import('./runCrawlWithConfig.js');
    const result = await runCrawlWithConfig(opts);
    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
