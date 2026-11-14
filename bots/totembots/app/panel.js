const dot = document.getElementById('dot');
const state = document.getElementById('state');
const url = document.getElementById('url');

async function refresh() {
  const s = await window.totem.qwenState();
  url.textContent = s.url || '';
  dot.className = 'dot ' + (s.loggedIn ? 'ok' : 'bad');
  state.textContent = s.loggedIn ? 'Qwen: вход выполнен' : 'Qwen: войдите справа';
}

const login = document.getElementById('login');
const chromeBtn = document.getElementById('chrome');
chromeBtn.onclick = async () => {
  chromeBtn.disabled = true;
  await window.totem.qwenLoginChrome();
  chromeBtn.disabled = false;
  refresh();
};
window.totem.onLoginStatus((t) => { login.textContent = t; });
document.getElementById('reload').onclick = () => window.totem.qwenReload();
window.totem.onQwenUrl(() => refresh());
setInterval(refresh, 3000);
refresh();
