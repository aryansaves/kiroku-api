// src/bot/handlers/command.ts
import { Composer, InlineKeyboard } from "grammy";
import { User } from "../../models/user";
import { Log } from "../../models/log";
import { formatJournalEntry, buildPagination, MONTHS } from "./messages";

export const commandsComposer = new Composer();

commandsComposer.command("start", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  const telegramIdStr = telegramUser.id.toString();

  try {
    let user = await User.findOne({ telegramId: telegramIdStr });

    if (user) {
      await ctx.reply(
        `Welcome back, ${user.displayName}! ✨\n\n` +
        `Your public media journal is live at:\n` +
        `👉 https://kiroku.com/u/${user.username}\n\n` +
        `Type /log to view your journal entries.`
      );
      return;
    }

    const fallbackUsername = telegramUser.username
      ? telegramUser.username.toLowerCase()
      : `user-${telegramIdStr.slice(-6)}`;

    user = await User.create({
      telegramId: telegramIdStr,
      telegramUsername: telegramUser.username || null,
      username: fallbackUsername,
      displayName: telegramUser.first_name,
    });

    await ctx.reply(
      `Your personal media journal has been initialized!\n\n` +
      `📖 Profile: https://kiroku.com/u/${user.username}\n\n` +
      `To change your custom web address, type:\n` +
      `/username your_new_name`
    );
  } catch (error) {
    console.error("Critical error during bot /start command sequencing:", error);
    await ctx.reply("❌ Infrastructure error occurred while initializing your journal profile space.");
  }
});

commandsComposer.command("username", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  const args = ctx.match?.trim();
  if (!args) {
    await ctx.reply("⚠️ Missing argument. Example: `/username aryan`");
    return;
  }

  const targetUsername = args.toLowerCase();
  const usernameRegex = /^[a-z0-9-]+$/;
  if (!usernameRegex.test(targetUsername) || targetUsername.length < 3 || targetUsername.length > 32) {
    await ctx.reply("❌ Invalid format. Usernames must be 3-32 alphanumeric characters or hyphens only.");
    return;
  }

  const reservedKeywords = new Set(["www", "api", "admin", "auth", "static", "cdn", "kiroku", "internal"]);
  if (reservedKeywords.has(targetUsername)) {
    await ctx.reply("❌ This identifier is a reserved infrastructure keyword.");
    return;
  }

  try {
    const existingUser = await User.findOne({ username: targetUsername });
    if (existingUser) {
      await ctx.reply("❌ This username is already claimed by another user.");
      return;
    }

    const updatedUser = await User.findOneAndUpdate(
      { telegramId: telegramUser.id.toString() },
      { username: targetUsername },
      { new: true }
    );

    if (!updatedUser) {
      await ctx.reply("❌ Profile not found. Use /start first.");
      return;
    }

    await ctx.reply(`✅ Username updated! Your journal is now at:\n👉 https://kiroku.com/u/${targetUsername}`);
  } catch (error) {
    console.error("Error modifying profile username:", error);
    await ctx.reply("❌ Database connection error while updating username.");
  }
});

// /help — list all commands and features
commandsComposer.command("help", async (ctx) => {
  await ctx.reply(
    `📖 <b>Kiroku Bot — Commands &amp; Guide</b>\n─────────\n\n` +
    `<b>/start</b> — Initialize your journal account\n` +
    `<b>/log</b> — View your journal entries (paginated)\n` +
    `<b>/username &lt;name&gt;</b> — Set your custom profile URL\n` +
    `<b>/help</b> — Show this guide\n\n` +
    `<b>Logging</b>\n` +
    `Send any title to log it. The bot finds matches and lets you pick the right one, then add a note or rating.\n\n` +
    `<b>Editing</b>\n` +
    `<b>/MovieTitle your note here</b> — Add or update a note on an existing log\n` +
    `<b>/MovieTitle rating: 8</b> — Set rating on an existing log\n` +
    `Both can be combined: <b>/Inception mind-bending rating: 9</b>\n\n` +
    `<b>Supported Media</b>\n` +
    `Movie, Series, Anime, Manga, Comic, Book`,
    { parse_mode: "HTML" }
  );
});

// /log — journal-themed paginated entry viewer
commandsComposer.command("log", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  await ctx.replyWithChatAction("typing");

  try {
    const user = await User.findOne({ telegramId: telegramUser.id.toString() });
    if (!user) {
      await ctx.reply("❌ Account not found. Run /start first.");
      return;
    }

    const PER_PAGE = 5;
    const totalLogs = await Log.countDocuments({
      userId: user._id,
      status: { $ne: "planned" }
    });

    if (totalLogs === 0) {
      await ctx.reply("📖 Your journal is empty. Send me a message about something you watched or read!");
      return;
    }

    const totalPages = Math.ceil(totalLogs / PER_PAGE);
    const logs = await Log.find({
      userId: user._id,
      status: { $ne: "planned" }
    })
      .sort({ createdAt: -1 })
      .limit(PER_PAGE)
      .lean();

    const month = MONTHS[new Date().getMonth()];
    const year = new Date().getFullYear();
    let text = `${month} ${year}\n─────────\n\n`;
    text += logs.map((l, i) => formatJournalEntry(l, i + 1)).join("\n\n");

    const nav = buildPagination(0, totalPages, "logpage");
    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: nav,
    });

  } catch (error) {
    console.error("Error executing /log command:", error);
    await ctx.reply("❌ An infrastructure error occurred while fetching your journal.");
  }
});

// Keep /history as alias for compatibility
commandsComposer.command("history", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  await ctx.replyWithChatAction("typing");

  try {
    const user = await User.findOne({ telegramId: telegramUser.id.toString() });
    if (!user) {
      await ctx.reply("❌ Account not found. Run /start first.");
      return;
    }

    const logs = await Log.find({
      userId: user._id,
      status: { $ne: "planned" }
    })
      .sort({ createdAt: 1 })
      .lean();

    if (logs.length === 0) {
      await ctx.reply("📖 Your journal is empty. Send me a message about something you watched or read to log it!");
      return;
    }

    interface ILog {
      title: string;
      mediaType: string;
      status: string;
      createdAt: string | Date;
      rating?: number | null;
      notes?: string | null;
    }

    const journalLines = logs.map((log: ILog) => {
      const date = new Date(log.createdAt);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const timestamp = `${day}-${month}-${year} ${hours}:${minutes}`;

      let verb = "consumed";
      if (log.mediaType === "anime" || log.mediaType === "movie" || log.mediaType === "series") verb = "watched";
      if (log.mediaType === "book" || log.mediaType === "manga" || log.mediaType === "comic") verb = "read";

      const notesContext = log.notes ? ` and noted: "${log.notes}"` : "";
      const ratingContext = log.rating ? ` (${log.rating}/10)` : "";

      return `📅 ${timestamp} — I ${verb} <b>${log.title}</b>${ratingContext}${notesContext}`;
    });

    const header = `📖 <b>${user.displayName}'s Personal Media Journal</b>\n───────────────────\n\n`;
    const fullHistoryMessage = header + journalLines.join("\n\n");

    if (fullHistoryMessage.length > 4000) {
      await ctx.reply(
        "📝 Your history is too long for a single message! " +
        `View your full journal on the web at:\n👉 https://kiroku.com/u/${user.username}\n\n` +
        `Or use /log for a paginated journal view.`
      );
      return;
    }

    await ctx.reply(fullHistoryMessage, { parse_mode: "HTML" });

  } catch (error) {
    console.error("Error executing bot history timeline fetch:", error);
    await ctx.reply("❌ An infrastructure error occurred while compiling your journal history.");
  }
});
