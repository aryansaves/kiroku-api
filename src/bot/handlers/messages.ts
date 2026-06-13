// src/bot/handlers/message.ts
import { Composer } from "grammy";
import { parseUserMessage } from "../nlp";
import { searchMetadataPool,type MetadataItem } from "../../lib/metadata";
import { Log } from "../../models/log";
import { User } from "../../models/user";
import { env } from "../../config";

export const messageComposer = new Composer();

messageComposer.on("message:text", async (ctx) => {
  const messageText = ctx.message.text.trim();
  const telegramIdStr = ctx.from.id.toString();
  const server = (ctx as any).fastifyApp;

  const stateKey = `state:${telegramIdStr}`;

  try {
    // ----------------------------------------------------------------
    // LAYER A: INTERCEPT ACTIVE STATE MACHINE CONTEXTS
    // ----------------------------------------------------------------
    const activeStateRaw = await server.redis.get(stateKey);
    
    if (activeStateRaw) {
      const state = JSON.parse(activeStateRaw);
      await server.redis.del(stateKey);

      // Context 1: Confirming an In-Place Rating Update
      if (state.type === "CONFIRM_UPDATE") {
        if (messageText.toLowerCase() === "yes" || messageText.toLowerCase() === "y") {
          await ctx.replyWithChatAction("typing");
          
          const response = await fetch(`http://localhost:${env.PORT}/internal/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
            body: JSON.stringify(state.payload),
          });

          if (response.ok) {
            await ctx.reply(`✅ *Rating Updated In-Place\\!*`, { parse_mode: "MarkdownV2" });
          } else {
            await ctx.reply("❌ Infrastructure error applying updates.");
          }
          return;
        } else {
          await ctx.reply("❌ Update aborted. Your original log remains unchanged.");
          return;
        }
      }

      // Context 2: Resolving a Disambiguation Menu Choice
      if (state.type === "DISAMBIGUATE") {
        const selectionIndex = parseInt(messageText, 10) - 1;
        const options: MetadataItem[] = state.options;

        // 1. VALIDATION GUARD RUNS FIRST
        if (isNaN(selectionIndex) || selectionIndex < 0 || selectionIndex >= options.length) {
          await ctx.reply(`❌ Invalid choice. Selection aborted. Please reply with a valid number between 1 and ${options.length}.`);
          return;
        }

        // 2. ASSIGNMENT RUNS ONLY AFTER PASSING CHECKS (Resolves Type Error)
        const chosenMedia = options[selectionIndex];
        if (!chosenMedia) {
          await ctx.reply("❌ State error: Choice out of bounds. Please try again.");
          return;
        }

        const internalPayload = {
          ...state.originalPayload,
          title: chosenMedia.canonicalTitle,
          coverImage: chosenMedia.coverImage,
          mediaType: chosenMedia.mediaType,
          externalIds: chosenMedia.externalIds,
        };

        const user = await User.findOne({ telegramId: telegramIdStr });
        const existingLog = await Log.findOne({ userId: user?._id, title: chosenMedia.canonicalTitle });

        if (existingLog) {
          await server.redis.set(stateKey, JSON.stringify({ type: "CONFIRM_UPDATE", payload: internalPayload }), "EX", 300);
          await ctx.reply(`📝 *"${chosenMedia.canonicalTitle}"* already exists in your journal.\n\nDid you mean to update its rating? Reply *yes* or *no*.`, { parse_mode: "Markdown" });
          return;
        }

        await fetch(`http://localhost:${env.PORT}/internal/logs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
          body: JSON.stringify(internalPayload),
        });

        await ctx.reply(`✅ *Logged Successfully\\!*\n*Title:* ${chosenMedia.canonicalTitle.replace(/[_*\[\]()~`>#+-=|{}.!]/g, "\\$&")}`, { parse_mode: "MarkdownV2" });
        return;
      }
    }

    // ----------------------------------------------------------------
    // LAYER B: RUN NATURAL LANGUAGE PROCESSING ENGINE
    // ----------------------------------------------------------------
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

    const matches = await searchMetadataPool(server, nlpResult.title, nlpResult.mediaType);

    if (matches.length === 0) {
      const internalPayload = {
        telegramId: telegramIdStr,
        mediaType: nlpResult.mediaType,
        status: nlpResult.status,
        title: nlpResult.title,
        coverImage: null,
        rating: nlpResult.rating,
        notes: nlpResult.notes,
        progress: nlpResult.progress,
        externalIds: { anilistId: null, malId: null, tmdbId: null },
      };

      await fetch(`http://localhost:${env.PORT}/internal/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
        body: JSON.stringify(internalPayload),
      });

      await ctx.reply(`✅ *Logged Successfully \\(Fallback Mode\\)\\!*`, { parse_mode: "MarkdownV2" });
      return;
    }

    // Exact single match found
    if (matches.length === 1 || matches[0]?.canonicalTitle.toLowerCase() === nlpResult.title.toLowerCase()) {
      const exactMedia = matches[0];
      if (!exactMedia) return;
      const internalPayload = {
        telegramId: telegramIdStr,
        mediaType: exactMedia.mediaType,
        status: nlpResult.status,
        title: exactMedia.canonicalTitle,
        coverImage: exactMedia.coverImage,
        rating: nlpResult.rating,
        notes: nlpResult.notes,
        progress: nlpResult.progress,
        externalIds: exactMedia.externalIds,
      };

      const existingLog = await Log.findOne({ userId: user._id, title: exactMedia.canonicalTitle });
      if (existingLog) {
        await server.redis.set(stateKey, JSON.stringify({ type: "CONFIRM_UPDATE", payload: internalPayload }), "EX", 300);
        await ctx.reply(`📝 *"${exactMedia.canonicalTitle}"* already exists in your journal.\n\nDid you mean to update its rating? Reply *yes* or *no*.`, { parse_mode: "Markdown" });
        return;
      }

      await fetch(`http://localhost:${env.PORT}/internal/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bot-Secret": env.BOT_INTERNAL_SECRET },
        body: JSON.stringify(internalPayload),
      });

      await ctx.reply(`✅ *Logged:* ${exactMedia.canonicalTitle.replace(/[_*\[\]()~`>#+-=|{}.!]/g, "\\$&")}`, { parse_mode: "MarkdownV2" });
      return;
    }

    // ----------------------------------------------------------------
    // LAYER C: TRIGGER MULTI-CHOICE DISAMBIGUATION MENU (UP TO 5 ITEMS)
    // ----------------------------------------------------------------
    const menuOptionsText = matches.map((m, idx) => `${idx + 1}. *${m.canonicalTitle}* (${m.mediaType})`).join("\n");
    
    const basePayloadData = {
      telegramId: telegramIdStr,
      status: nlpResult.status,
      rating: nlpResult.rating,
      notes: nlpResult.notes,
      progress: nlpResult.progress,
    };

    await server.redis.set(stateKey, JSON.stringify({
      type: "DISAMBIGUATE",
      options: matches,
      originalPayload: basePayloadData
    }), "EX", 300);

    await ctx.reply(
      `🤔 *I found multiple matches for "${nlpResult.title}":*\n\n` +
      `${menuOptionsText}\n\n` +
      `Reply with the *number* (1 to ${matches.length}) corresponding to your choice.`,
      { parse_mode: "Markdown" }
    );

  } catch (error) {
    console.error("State Machine Error Exception:", error);
    await ctx.reply("❌ Connection error inside the application state loop.");
  }
});