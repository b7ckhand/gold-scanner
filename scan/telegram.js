'use strict';
/* Minimal Telegram Bot API client. */
async function call(token, method, body, fetchImpl) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  let json = null; try { json = await res.json(); } catch (e) { }
  if (!res.ok || !json || !json.ok) throw new Error(`Telegram ${method} failed: ${(json && json.description) || res.status}`);
  return json.result;
}

function sendMessage({ token, chatId, text, url, fetchImpl }) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: 'Open desk', web_app: { url } }]] };
  return call(token, 'sendMessage', body, fetchImpl);
}

/* Sets the default menu button for every private chat with the bot, so it opens the Mini App. */
function setMenuButton({ token, url, text = 'Gold desk', fetchImpl }) {
  return call(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url } } }, fetchImpl);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

module.exports = { sendMessage, setMenuButton, esc };
