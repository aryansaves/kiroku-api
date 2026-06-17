import { Composer, InlineKeyboard } from "grammy";
import { parseUserMessage } from "../nlp";
import { searchMetadataPool, type MetadataItem } from "../../lib/metadata";
import { Log } from "../../models/log";
import { User } from "../../models/user";
import { env } from "../../config";

export const messageComposer = new Composer();
export const callbackComposer = new Composer();

const MEDIA_TYPES = ["Movie", "Series", "Anime", "Manga", "Comic", "Book"] as const;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getStateKey(telegramId: string) {
  return `state:${telegramId}`;
}

async function postToInternal(payload: Record<string, unknown>) {
  return fetch(`http://localhost:${env.PORT}/internal/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
    body: JSON.stringify(payload),
  });
}

function ratingToStars(rating: number | null): string {
  if (rating === null || rating === undefined) return "";
  const stars = Math.round(rating / 2);
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

function mediaTypeLabel(mt: string): string {
  const labels: Record<string, string> = {
    anime: "Anime", movie: "Film", series: "Series",
    book: "Book", manga: "Manga", comic: "Comic", game: "Game", music: "Music", podcast: "Podcast"
  };
  return labels[mt] || mt;
}

export const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
];

export function formatJournalEntry(log: any, index: number): string {
  const stars = ratingToStars(log.rating);
  const label = mediaTypeLabel(log.mediaType);
  let entry = `${index}. <b>${escapeHtml(log.title)}</b> (${label})`;
  if (stars) entry += ` ${stars}`;
  if (log.notes) entry += `\n  _${escapeHtml(log.notes.slice(0, 120))}${log.notes.length > 120 ? "\.\.\." : ""}_`;
  return entry;
}

function formatJournalDetail(log: any, vol: number, total: number): string {
  const d = new Date(log.createdAt);
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const monthDay = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const stars = ratingToStars(log.rating);
  const label = mediaTypeLabel(log.mediaType);

  let entry = `${month} ${year} — VOL\. ${vol}\n`;
  entry += `──────────────────────\n\n`;
  entry += `<b>${escapeHtml(log.title)}</b>\.\n`;
  entry += `${label}\. Reviewed on ${monthDay}, ${year}\.\n`;
  if (stars) entry += `Rating: ${stars}\n`;
  if (log.notes) entry += `\n${escapeHtml(log.notes)}`;
  return entry;
}

export function buildPagination(page: number, totalPages: number, prefix: string): InlineKeyboard | undefined {
  if (totalPages <= 1) return undefined;
  const kbd = new InlineKeyboard();
  if (page > 0) kbd.text("◀ Prev", `${prefix}:${page - 1}`);
  kbd.text(`${page + 1}/${totalPages}`, `${prefix}:noop`);
  if (page < totalPages - 1) kbd.text("Next ▶", `${prefix}:${page + 1}`);
  return kbd;
}

callbackComposer.callbackQuery(/^postselect:(.+)$/, async (ctx) => {
  const action = ctx.match[1]!;
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }

  const state = JSON.parse(raw);

  if (action === "skip") {
    await server.redis.del(stateKey);
    await ctx.answerCallbackQuery({ text: "Logging..." });
    const user = await User.findOne({ telegramId: telegramIdStr });
    const existingLog = await Log.findOne({ userId: user?._id, title: state.canonicalTitle });
    if (existingLog) {
      await server.redis.set(stateKey, JSON.stringify({
        type: "RELOG_DECISION", payload: state.payload,
        canonicalTitle: state.canonicalTitle, coverImage: state.coverImage,
      }), "EX", 300);
      const kbd = new InlineKeyboard()
        .text("Update rating/notes", "relog:update").row()
        .text("Mark as rewatched", "relog:rewatch").row()
        .text("Cancel", "relog:cancel");
      await ctx.editMessageText(
        `📝 <b>"${escapeHtml(state.canonicalTitle)}"</b> is already in your journal\.`,
        { parse_mode: "HTML", reply_markup: kbd }
      );
      return;
    }
    await postToInternal(state.payload);
    if (state.coverImage) {
      try {
        await ctx.replyWithPhoto(state.coverImage, { caption: `✅ <b>Logged:</b> ${escapeHtml(state.canonicalTitle)}`, parse_mode: "HTML" });
        await ctx.editMessageReplyMarkup(undefined);
        return;
      } catch { /* fall through */ }
    }
    await ctx.editMessageText(`✅ <b>Logged:</b> ${escapeHtml(state.canonicalTitle)}`, { parse_mode: "HTML" });
    return;
  }

  if (action === "note") {
    await server.redis.set(stateKey, JSON.stringify({
      type: "AWAIT_NOTE", payload: state.payload, canonicalTitle: state.canonicalTitle, coverImage: state.coverImage,
    }), "EX", 600);
    await ctx.editMessageText(
      `✏️ <b>${escapeHtml(state.canonicalTitle)}</b>\n\nWrite your note below:`,
      { parse_mode: "HTML" }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === "rating") {
    await server.redis.set(stateKey, JSON.stringify({
      type: "AWAIT_RATING", payload: state.payload, canonicalTitle: state.canonicalTitle, coverImage: state.coverImage,
    }), "EX", 600);
    await ctx.editMessageText(
      `⭐ <b>${escapeHtml(state.canonicalTitle)}</b>\n\nRate 0-10:`,
      { parse_mode: "HTML" }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  if (action === "cancel") {
    await server.redis.del(stateKey);
    await ctx.editMessageText("👌 Logging cancelled.", { parse_mode: "HTML" });
    await ctx.answerCallbackQuery();
    return;
  }
});

callbackComposer.callbackQuery(/^disambig:(\d+)$/, async (ctx) => {
  const index = parseInt(ctx.match[1]!, 10);
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }

  const state = JSON.parse(raw);
  if (!state.options || !Array.isArray(state.options)) {
    console.error("DISAMBIGUATE state missing options:", JSON.stringify(state));
    await ctx.answerCallbackQuery({ text: "Session state corrupted. Please send your message again." });
    await ctx.editMessageReplyMarkup(undefined);
    await server.redis.del(stateKey);
    return;
  }
  const options: MetadataItem[] = state.options;
  if (index < 0 || index >= options.length) { await ctx.answerCallbackQuery({ text: "Invalid." }); return; }

  const chosen = options[index]!;
  await server.redis.del(stateKey);

  const internalPayload = {
    ...state.originalPayload,
    title: chosen.canonicalTitle, coverImage: chosen.coverImage,
    mediaType: chosen.mediaType, externalIds: chosen.externalIds,
  };

  await server.redis.set(stateKey, JSON.stringify({
    type: "POST_SELECT",
    payload: internalPayload,
    canonicalTitle: chosen.canonicalTitle,
    coverImage: chosen.coverImage,
  }), "EX", 300);

  const kbd = new InlineKeyboard()
    .text("✏️ Add note", "postselect:note").row()
    .text("⭐ Add rating", "postselect:rating").row()
    .text("✅ Skip → Log", "postselect:skip").row()
    .text("❌ Cancel", "postselect:cancel");

  let card = `🎬 <b>${escapeHtml(chosen.canonicalTitle)}</b>`;
  if (chosen.year) card += ` (${chosen.year})`;
  card += ` [${mediaTypeLabel(chosen.mediaType)}]`;
  if (internalPayload.notes) card += `\n📝 <i>"${escapeHtml(internalPayload.notes)}"</i>`;
  if (internalPayload.rating) card += `\n⭐ ${ratingToStars(internalPayload.rating)} (${internalPayload.rating}/10)`;
  card += `\n\nAdd a note or rating, or skip to log now\.`;

  await ctx.editMessageText(card, { parse_mode: "HTML", reply_markup: kbd });
  await ctx.answerCallbackQuery();
});

callbackComposer.callbackQuery(/^searchpage:(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1]!, 10);
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }

  const state = JSON.parse(raw);
  if (!state.options || !Array.isArray(state.options)) {
    await ctx.answerCallbackQuery({ text: "This menu is stale. Please send your message again." });
    await ctx.editMessageReplyMarkup(undefined);
    return;
  }
  await showDisambiguationPage(ctx, state.options, page, state.originalPayload?.title || "");
  await ctx.answerCallbackQuery();
});

callbackComposer.callbackQuery(/^relog:(.+)$/, async (ctx) => {
  const action = ctx.match[1]!;
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }
  const state = JSON.parse(raw);

  if (action === "update") {
    await server.redis.set(stateKey, JSON.stringify({ type: "CONFIRM_UPDATE", payload: state.payload }), "EX", 300);
    const kbd = new InlineKeyboard().text("Yes", "confirm:yes").text("No", "confirm:no");
    await ctx.editMessageText(`📝 Update rating for <b>"${escapeHtml(state.canonicalTitle)}"</b>?`, { parse_mode: "HTML", reply_markup: kbd });
    await ctx.answerCallbackQuery();
    return;
  }
  if (action === "rewatch") {
    await ctx.answerCallbackQuery({ text: "Logging as rewatched..." });
    const rewatchPayload = { ...state.payload, forceNew: true, status: "rewatching" };
    const response = await postToInternal(rewatchPayload);
    await server.redis.del(stateKey);
    if (response.ok) {
      await ctx.editMessageText(`✅ <b>Rewatched:</b> ${escapeHtml(state.canonicalTitle)}`, { parse_mode: "HTML" });
      if (state.coverImage) {
        try { await ctx.replyWithPhoto(state.coverImage, { caption: "📖 Rewatched entry." }); } catch { /* */ }
      }
    } else {
      await ctx.editMessageText("❌ Infrastructure error logging rewatch.");
    }
    return;
  }
  if (action === "cancel") {
    await server.redis.del(stateKey);
    await ctx.editMessageText("👌 Okay, nothing changed.");
    await ctx.answerCallbackQuery();
    return;
  }
});

callbackComposer.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const answer = ctx.match[1]!;
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);
  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }
  const state = JSON.parse(raw);
  await server.redis.del(stateKey);
  if (answer === "yes") {
    await ctx.answerCallbackQuery({ text: "Updating..." });
    const response = await postToInternal(state.payload);
    if (response.ok) {
      await ctx.editMessageText("✅ <b>Rating Updated!</b>", { parse_mode: "HTML" });
    } else {
      await ctx.editMessageText("❌ Infrastructure error applying updates.");
    }
  } else {
    await ctx.editMessageText("❌ Update aborted.");
    await ctx.answerCallbackQuery();
  }
});

callbackComposer.callbackQuery("delete:confirm", async (ctx) => {
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);
  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }
  const state = JSON.parse(raw);
  await server.redis.del(stateKey);

  await Log.findByIdAndDelete(state.logId);
  await ctx.editMessageText(`🗑 <b>Deleted:</b> ${escapeHtml(state.title)}`, { parse_mode: "HTML" });
  await ctx.answerCallbackQuery({ text: "Deleted." });
});

callbackComposer.callbackQuery("delete:cancel", async (ctx) => {
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);
  await server.redis.del(stateKey);
  await ctx.editMessageText("👌 Delete cancelled.");
  await ctx.answerCallbackQuery();
});

callbackComposer.callbackQuery(/^deletepick:(.+)$/, async (ctx) => {
  const logId = ctx.match[1]!;
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);
  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }
  const state = JSON.parse(raw);

  const chosen = state.logs.find((l: any) => l._id === logId);
  if (!chosen) { await ctx.answerCallbackQuery({ text: "Invalid." }); return; }

  await server.redis.set(stateKey, JSON.stringify({
    type: "CONFIRM_DELETE",
    logId: chosen._id,
    title: chosen.title,
  }), "EX", 120);

  const kbd = new InlineKeyboard()
    .text("Yes, delete", "delete:confirm").row()
    .text("Cancel", "delete:cancel");

  await ctx.editMessageText(
    `🗑 <b>Delete "${escapeHtml(chosen.title)}"?</b>\nThis cannot be undone.`,
    { parse_mode: "HTML", reply_markup: kbd }
  );
  await ctx.answerCallbackQuery();
});

callbackComposer.callbackQuery("logpage:noop", async (ctx) => { await ctx.answerCallbackQuery(); });

callbackComposer.callbackQuery(/^logpage:(\d+)$/, async (ctx) => {
  const page = parseInt(ctx.match[1]!, 10);
  const telegramIdStr = ctx.from.id.toString();
  const PER_PAGE = 5;

  const user = await User.findOne({ telegramId: telegramIdStr });
  if (!user) { await ctx.answerCallbackQuery({ text: "Account not found." }); return; }

  const totalLogs = await Log.countDocuments({ userId: user._id, status: { $ne: "planned" } });
  const totalPages = Math.max(1, Math.ceil(totalLogs / PER_PAGE));
  const clamped = Math.max(0, Math.min(page, totalPages - 1));

  const logs = await Log.find({ userId: user._id, status: { $ne: "planned" } })
    .sort({ createdAt: -1 }).skip(clamped * PER_PAGE).limit(PER_PAGE).lean();

  if (logs.length === 0) { await ctx.answerCallbackQuery({ text: "No entries." }); return; }

  const month = MONTHS[new Date().getMonth()];
  const year = new Date().getFullYear();
  let text = `${month} ${year}\n─────────\n\n`;
  text += logs.map((l, i) => formatJournalEntry(l, clamped * PER_PAGE + i + 1)).join("\n\n");

  const nav = buildPagination(clamped, totalPages, "logpage");
  await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: nav });
  await ctx.answerCallbackQuery();
});

callbackComposer.callbackQuery("searchpage:noop", async (ctx) => { await ctx.answerCallbackQuery(); });

const PER_SEARCH_PAGE = 5;

async function showDisambiguationPage(ctx: any, options: MetadataItem[], page: number, queryTitle: string, edit = true) {
  const totalPages = Math.ceil(options.length / PER_SEARCH_PAGE);
  const clamped = Math.max(0, Math.min(page, totalPages - 1));
  const slice = options.slice(clamped * PER_SEARCH_PAGE, clamped * PER_SEARCH_PAGE + PER_SEARCH_PAGE);

  const kbd = new InlineKeyboard();
  slice.forEach((m, i) => {
    const yearStr = m.year ? ` (${m.year})` : "";
    const label = mediaTypeLabel(m.mediaType);
    kbd.text(
      `${clamped * PER_SEARCH_PAGE + i + 1}. ${m.canonicalTitle}${yearStr} [${label}]`,
      `disambig:${clamped * PER_SEARCH_PAGE + i}`
    ).row();
  });

  if (totalPages > 1) {
    const navRow: { text: string; callback_data: string }[] = [];
    if (clamped > 0) navRow.push({ text: "◀ Prev", callback_data: `searchpage:${clamped - 1}` });
    navRow.push({ text: `${clamped + 1}/${totalPages}`, callback_data: "searchpage:noop" });
    if (clamped < totalPages - 1) navRow.push({ text: "Next ▶", callback_data: `searchpage:${clamped + 1}` });
    for (const b of navRow) {
      kbd.text(b.text, b.callback_data);
    }
  }

  const text = `🤔 <b>Matches for "${escapeHtml(queryTitle)}":</b>`;
  if (edit) {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kbd });
  } else {
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kbd });
  }
}

messageComposer.on("message:text", async (ctx) => {
  const messageText = ctx.message.text.trim();
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  try {
    if (messageText.startsWith("/")) {
      const knownCommands = ["start", "username", "log", "history", "help", "delete"];
      const firstWord = messageText.slice(1).split(/\s+/)[0]?.toLowerCase();
      if (firstWord && !knownCommands.includes(firstWord)) {
        await handleMovieEdit(ctx, messageText, telegramIdStr, server);
        return;
      }
    }

    const activeStateRaw = await server.redis.get(stateKey);

    if (activeStateRaw) {
      const state = JSON.parse(activeStateRaw);

      if (state.type === "AWAIT_NOTE") {
        await server.redis.del(stateKey);
        const payload = { ...state.payload, notes: messageText };
        await ctx.replyWithChatAction("typing");
        const user = await User.findOne({ telegramId: telegramIdStr });
        const existingLog = await Log.findOne({ userId: user?._id, title: state.canonicalTitle });
        if (existingLog) {
          await server.redis.set(stateKey, JSON.stringify({
            type: "RELOG_DECISION", payload, canonicalTitle: state.canonicalTitle, coverImage: state.coverImage,
          }), "EX", 300);
          const kbd = new InlineKeyboard()
            .text("Update rating/notes", "relog:update").row()
            .text("Mark as rewatched", "relog:rewatch").row()
            .text("Cancel", "relog:cancel");
          await ctx.reply(`📝 <b>"${escapeHtml(state.canonicalTitle)}"</b> is already in your journal.`, { parse_mode: "HTML", reply_markup: kbd });
          return;
        }
        await postToInternal(payload);
        await sendSuccessReply(ctx, state.canonicalTitle, state.coverImage);
        return;
      }

      if (state.type === "AWAIT_RATING") {
        await server.redis.del(stateKey);
        const ratingNum = parseInt(messageText, 10);
        if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 10) {
          await server.redis.set(stateKey, JSON.stringify(state), "EX", 600);
          await ctx.reply("❌ Invalid rating. Please enter a number between 0 and 10.");
          return;
        }
        const payload = { ...state.payload, rating: ratingNum };
        await ctx.replyWithChatAction("typing");
        const user = await User.findOne({ telegramId: telegramIdStr });
        const existingLog = await Log.findOne({ userId: user?._id, title: state.canonicalTitle });
        if (existingLog) {
          await server.redis.set(stateKey, JSON.stringify({
            type: "RELOG_DECISION", payload, canonicalTitle: state.canonicalTitle, coverImage: state.coverImage,
          }), "EX", 300);
          const kbd = new InlineKeyboard()
            .text("Update rating/notes", "relog:update").row()
            .text("Mark as rewatched", "relog:rewatch").row()
            .text("Cancel", "relog:cancel");
          await ctx.reply(`📝 <b>"${escapeHtml(state.canonicalTitle)}"</b> is already in your journal.`, { parse_mode: "HTML", reply_markup: kbd });
          return;
        }
        await postToInternal(payload);
        await sendSuccessReply(ctx, state.canonicalTitle, state.coverImage);
        return;
      }

      if (state.type === "CONFIRM_UPDATE" || state.type === "DISAMBIGUATE" || state.type === "RELOG_DECISION" || state.type === "POST_SELECT") {
        await ctx.reply("⚠️ Please use the buttons above.");
        return;
      }

      await server.redis.del(stateKey);
    }

    await ctx.replyWithChatAction("typing");
    const nlpResult = await parseUserMessage(messageText);

    if (nlpResult.confidence === "low" || !nlpResult.title) {
      await ctx.reply("🤔 I couldn't resolve the media title. Try phrasing your message clearly.");
      return;
    }

    const user = await User.findOne({ telegramId: telegramIdStr });
    if (!user) {
      await ctx.reply("❌ Please initialize your profile with /start first.");
      return;
    }

    await proceedToSearch(ctx, server, stateKey, nlpResult, telegramIdStr);

  } catch (error) {
    console.error("State Machine Error:", error);
    await ctx.reply("❌ Connection error inside the application state loop.");
  }
});

async function proceedToSearch(ctx: any, server: any, stateKey: string, nlpResult: any, telegramIdStr: string) {
  const matches = await searchMetadataPool(server, nlpResult.title, nlpResult.mediaType);

  if (matches.length === 0) {
    await ctx.reply(
      `🔍 <b>No matches found for</b> <i>"${escapeHtml(nlpResult.title)}"</i>.\nTry a different search term.`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (matches.length === 1) {
    const m = matches[0]!;
    const internalPayload = {
      telegramId: telegramIdStr, mediaType: m.mediaType, status: nlpResult.status,
      title: m.canonicalTitle, coverImage: m.coverImage, rating: nlpResult.rating,
      notes: nlpResult.notes, progress: nlpResult.progress, externalIds: m.externalIds,
    };

  await server.redis.set(stateKey, JSON.stringify({
    type: "POST_SELECT", payload: internalPayload,
    canonicalTitle: m.canonicalTitle, coverImage: m.coverImage,
  }), "EX", 300);

  const kbd = new InlineKeyboard()
    .text("✏️ Add note", "postselect:note").row()
    .text("⭐ Add rating", "postselect:rating").row()
    .text("✅ Skip → Log", "postselect:skip").row()
    .text("❌ Cancel", "postselect:cancel");

  let card = `🎬 <b>${escapeHtml(m.canonicalTitle)}</b>`;
  if (m.year) card += ` (${m.year})`;
  card += ` [${mediaTypeLabel(m.mediaType)}]`;
  if (nlpResult.notes) card += `\n📝 <i>"${escapeHtml(nlpResult.notes)}"</i>`;
  if (nlpResult.rating) card += `\n⭐ ${ratingToStars(nlpResult.rating)} (${nlpResult.rating}/10)`;
  card += `\n\nAdd a note or rating, or skip to log now\.`;

    await ctx.reply(card, { parse_mode: "HTML", reply_markup: kbd });
    return;
  }

  await server.redis.set(stateKey, JSON.stringify({
    type: "DISAMBIGUATE",
    options: matches,
    originalPayload: {
      telegramId: telegramIdStr, status: nlpResult.status,
      rating: nlpResult.rating, notes: nlpResult.notes, progress: nlpResult.progress,
    },
    page: 0,
  }), "EX", 300);

  await showDisambiguationPage(ctx, matches, 0, nlpResult.title, false);
}

async function handleMovieEdit(ctx: any, messageText: string, telegramIdStr: string, server: any) {
  const withoutSlash = messageText.slice(1);
  const user = await User.findOne({ telegramId: telegramIdStr });
  if (!user) { await ctx.reply("❌ Use /start first\."); return; }

  const ratingRe = /(?:^|\s)rating:\s*(\d+)/i;
  const ratingMatch = withoutSlash.match(ratingRe);
  const rating = ratingMatch ? parseInt(ratingMatch[1]!, 10) : null;

  if (rating !== null && (isNaN(rating) || rating < 0 || rating > 10)) {
    await ctx.reply("❌ Rating must be 0\-10\.");
    return;
  }

  let searchText = withoutSlash.replace(ratingRe, "").trim();
  if (!searchText) { await ctx.reply("❌ Usage: `/MovieTitle your note here rating: 8`"); return; }

  const words = searchText.split(/\s+/);
  let matchedLog: any = null;
  let noteText = "";

  for (let w = words.length; w >= 1; w--) {
    const candidate = words.slice(0, w).join(" ");
    const regexParts = words.slice(0, w).map((wd: string) => `(?=.*${wd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);
    const fuzzyRe = new RegExp(`^${regexParts.join("")}.*$`, "i");

    const logs = await Log.find({
      userId: user._id,
      title: { $regex: fuzzyRe }
    }).lean();

    if (logs.length === 1) {
      matchedLog = logs[0];
      noteText = words.slice(w).join(" ").trim();
      break;
    }

    if (logs.length > 1) {
      const kbd = new InlineKeyboard();
      logs.slice(0, 5).forEach((l: any, i: number) => {
        kbd.text(l.title, `editpick:${l._id}`).row();
      });

      await server.redis.set(getStateKey(telegramIdStr), JSON.stringify({
        type: "EDIT_PICK",
        noteText: words.slice(w).join(" ").trim(),
        rating,
        logs: logs.slice(0, 5).map((l: any) => ({ _id: l._id.toString(), title: l.title })),
      }), "EX", 120);

      await ctx.reply(
        `🔍 <b>Multiple matches for "${escapeHtml(candidate)}":</b>`,
        { parse_mode: "HTML", reply_markup: kbd }
      );
      return;
    }
  }

  if (!matchedLog) {
    await ctx.reply(`❌ No log found matching *"${escapeHtml(words[0] || searchText)}"*\.\nTry a different search term or check the exact title with /log\.`, { parse_mode: "HTML" });
    return;
  }

  const updateFields: Record<string, unknown> = {};
  if (noteText) updateFields.notes = noteText;
  if (rating !== null) updateFields.rating = rating;
  await Log.findByIdAndUpdate(matchedLog._id, updateFields);
  matchedLog.notes = noteText || matchedLog.notes;
  matchedLog.rating = rating !== null ? rating : matchedLog.rating;

  const stars = ratingToStars(matchedLog.rating);
  const month = MONTHS[new Date().getMonth()];
  const year = new Date().getFullYear();

  let response = `📖 <b>Journal Entry Updated</b>\n${month} ${year}\n─────────\n\n`;
  response += `<b>${escapeHtml(matchedLog.title)}</b>\n`;
  response += `${mediaTypeLabel(matchedLog.mediaType)}\.\n`;
  if (noteText) response += `📝 _${escapeHtml(noteText.slice(0, 150))}${noteText.length > 150 ? "\.\.\." : ""}_\n`;
  if (stars) response += `⭐ ${stars}\n`;

  await ctx.reply(response, { parse_mode: "HTML" });
}

callbackComposer.callbackQuery(/^editpick:(.+)$/, async (ctx) => {
  const logId = ctx.match[1]!;
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;
  const stateKey = getStateKey(telegramIdStr);

  const raw = await server.redis.get(stateKey);
  if (!raw) { await ctx.answerCallbackQuery({ text: "Session expired." }); await ctx.editMessageReplyMarkup(undefined); return; }

  const state = JSON.parse(raw);
  await server.redis.del(stateKey);

  const chosen = state.logs.find((l: any) => l._id === logId);
  if (!chosen) { await ctx.answerCallbackQuery({ text: "Invalid selection." }); return; }

  const log = await Log.findById(logId);
  if (!log) { await ctx.editMessageText("❌ Log not found in database\."); await ctx.answerCallbackQuery(); return; }

  if (state.noteText) log.notes = state.noteText;
  if (state.rating !== null) log.rating = state.rating;
  await log.save();

  const stars = ratingToStars(log.rating);
  const month = MONTHS[new Date().getMonth()];
  const year = new Date().getFullYear();

  let response = `📖 <b>Journal Entry Updated</b>\n${month} ${year}\n─────────\n\n`;
  response += `<b>${escapeHtml(log.title)}</b>\n`;
  response += `${mediaTypeLabel(log.mediaType)}\.\n`;
  if (state.noteText) response += `📝 _${escapeHtml(state.noteText.slice(0, 150))}${state.noteText.length > 150 ? "\.\.\." : ""}_\n`;
  if (stars) response += `⭐ ${stars}\n`;

  await ctx.editMessageText(response, { parse_mode: "HTML" });
  await ctx.answerCallbackQuery({ text: "Updated!" });
});

async function sendSuccessReply(ctx: any, title: string, coverImage: string | null) {
  const caption = `✅ <b>Logged:</b> ${escapeHtml(title)}`;
  if (coverImage) {
    try {
      await ctx.replyWithPhoto(coverImage, { caption, parse_mode: "HTML" });
    } catch {
      await ctx.reply(caption, { parse_mode: "HTML" });
    }
  } else {
    await ctx.reply(caption, { parse_mode: "HTML" });
  }
}
