const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer.html'));
}

ipcMain.handle('open-ozon-login', async () => {
  const loginWin = new BrowserWindow({ width: 1200, height: 800 });
  await loginWin.loadURL('https://www.ozon.ru/');
  return true;
});

ipcMain.handle('collect-url', async (_event, url) => {
  const win = new BrowserWindow({ show: true, width: 1100, height: 800, webPreferences: { javascript: true } });
  try {
    await win.loadURL(url);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const parsed = await win.webContents.executeJavaScript(`(${extract.toString()})()`);
    return parsed;
  } finally {
    win.close();
  }
});

function extract() {
  const name = (document.querySelector('h1') && document.querySelector('h1').textContent.trim()) || '';
  const sku = (location.pathname.match(/(\\d{6,})/) || [])[1] || String(Date.now());
  const title = document.title || '';
  const visible = document.body && document.body.innerText ? document.body.innerText.slice(0, 4000) : '';
  const challenge = /доступ ограничен|подтвердите[\s\S]{0,40}не робот|are you a robot|just a moment/i.test(
    title + '\n' + name + '\n' + visible,
  );
  if (challenge && (!name || /^ozon\.?$/i.test(name))) return { blocked: true };
  const image = (document.querySelector('meta[property="og:image"]') || {}).content;
  return {
    skuId: sku,
    name: name || ('Electron 采集 ' + sku),
    sourceUrl: location.href,
    mainImageUrl: image,
    imageUrls: image ? [image] : [],
    price: 0,
    currency: 'RUB',
    stock: 1,
    specs: [],
    salesCount: 0,
  };
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
