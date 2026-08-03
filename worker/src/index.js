// Webhook de Telegram para el bot de autos: maneja los botones ✅/❌ y la
// pregunta de seguimiento ("¿qué te gustó / no te gustó?"), guardando todo
// en Workers KV para ir armando el perfil de gustos de Nicolás.

const TELEGRAM_API = (token) => `https://api.telegram.org/bot${token}`;

async function telegram(env, method, body) {
  const res = await fetch(`${TELEGRAM_API(env.TELEGRAM_BOT_TOKEN)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function handleCallbackQuery(env, callbackQuery) {
  const [action, listingId] = (callbackQuery.data || "").split(":");
  const chatId = callbackQuery.message.chat.id;
  const originalMessageId = callbackQuery.message.message_id;

  if (action === "noop") {
    // Ya se marcó feedback para este auto; el botón queda de recuerdo, no hace nada.
    await telegram(env, "answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "Ya marcaste este auto.",
    });
    return;
  }

  const sentiment = action === "like" ? "like" : "dislike";

  // Saca el spinner de carga del botón cuanto antes.
  await telegram(env, "answerCallbackQuery", { callback_query_id: callbackQuery.id });

  await env.BOT_AUTOS_DATA.put(
    `pending:${chatId}`,
    JSON.stringify({ listingId, sentiment, originalMessageId }),
    { expirationTtl: 3600 }
  );

  const prompt =
    sentiment === "like"
      ? "👍 ¿Qué te gustó de este auto? Respondé a este mensaje."
      : "👎 ¿Qué NO te gustó de este auto? Respondé a este mensaje.";

  // Responde citando el mensaje del auto (Telegram muestra su foto/preview arriba),
  // así no hay que ir a buscarlo scrolleando.
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: prompt,
    reply_to_message_id: originalMessageId,
    reply_markup: { force_reply: true },
  });

  // Marca visualmente el mensaje original para saber de un vistazo que ya se contestó.
  const marker = sentiment === "like" ? "✅ Marcado: me gustó" : "❌ Marcado: no me gustó";
  await telegram(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: originalMessageId,
    reply_markup: { inline_keyboard: [[{ text: marker, callback_data: "noop" }]] },
  });
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  if (!text) return;

  const pendingRaw = await env.BOT_AUTOS_DATA.get(`pending:${chatId}`);
  if (!pendingRaw) return; // no había pregunta pendiente, no hacemos nada

  const { listingId, sentiment } = JSON.parse(pendingRaw);
  const listingRaw = await env.BOT_AUTOS_DATA.get(`listing:${listingId}`);
  const listing = listingRaw ? JSON.parse(listingRaw) : {};

  const feedback = {
    listingId,
    sentiment,
    reason: text,
    ts: new Date().toISOString(),
    ...listing,
  };

  await env.BOT_AUTOS_DATA.put(
    `feedback:${Date.now()}_${listingId}`,
    JSON.stringify(feedback)
  );
  await env.BOT_AUTOS_DATA.delete(`pending:${chatId}`);

  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: "Anotado, gracias 🙌 Esto me ayuda a entender mejor lo que buscás.",
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("ok", { status: 200 });
    }

    const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }

    const update = await request.json();

    try {
      if (update.callback_query) {
        await handleCallbackQuery(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }
    } catch (err) {
      console.error(err);
    }

    return new Response("ok", { status: 200 });
  },
};
