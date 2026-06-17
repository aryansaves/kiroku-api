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
        `📖 <b>Welcome back, ${user.displayName}!</b>\n\n` +
        `Your journal: https://kiroku.com/u/${user.username}\n\n` +
        `<b>Quick start</b>\n` +
        `• Send any title to log it — <i>"watched Inception 9/10"</i>\n` +
        `• /log — Browse your journal\n` +
        `• /MovieTitle notes — Edit an entry\n` +
        `• /help — All commands`,
        { parse_mode: "HTML" }
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
      `📖 <b>Welcome to Kiroku, ${telegramUser.first_name}!</b>\n\n` +
      `Your personal media journal is live. Track every film, series, book, comic, anime, and manga you experience.\n\n` +
      `🌐 <b>Your journal</b>\n` +
      `https://kiroku.com/u/${user.username}\n\n` +
      `<b>Getting started</b>\n` +
      `1. Send a title — <i>"watched Dune 2"</i>\n` +
      `2. Pick the right match from the list\n` +
      `3. Add a note or rating, then log it\n\n` +
      `Type /help to see all commands.`,
      { parse_mode: "HTML" }
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

commandsComposer.command("help", async (ctx) => {
  await ctx.reply(
    `📖 <b>Kiroku — Commands &amp; Guide</b>\n` +
    `──────────────────────\n\n` +
    `<b>Commands</b>\n` +
    `/start — Create your journal account\n` +
    `/log — Browse entries (paginated, latest first)\n` +
    `/delete &lt;title&gt; — Remove a log entry\n` +
    `/username &lt;name&gt; — Set your profile URL\n` +
    `/help — This guide\n\n` +
    `<b>Logging Media</b>\n` +
    `Send any message with a title. The bot finds matches across all media types — movies, series, anime, manga, comics, and books — showing year and type for each.\n\n` +
    `<i>"watched Inception 4/5"</i> — extracts rating automatically\n` +
    `<i>"finished Dune best sci-fi ever"</i> — extracts notes\n\n` +
    `After picking a match, you can add a note, set a rating, or skip straight to logging.\n\n` +
    `<b>Editing Entries</b>\n` +
    `/MovieTitle your notes — Add or update notes\n` +
    `/MovieTitle rating: 8 — Set a rating (0-10)\n` +
    `Both together: /Inception mind-bending rating: 9\n\n` +
    `<b>Journal Display</b>\n` +
    `/log shows your entries in journal format with star ratings and pagination. Each page shows 5 entries.\n\n` +
    `<b>Supported Media</b>\n` +
    `Film • Series • Anime • Manga • Comic • Book`,
    { parse_mode: "HTML" }
  );
});

commandsComposer.command("delete", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  const args = ctx.match?.trim();
  if (!args) {
    await ctx.reply("❌ Usage: `/delete movie title`");
    return;
  }

  try {
    const user = await User.findOne({ telegramId: telegramUser.id.toString() });
    if (!user) { await ctx.reply("❌ Use /start first."); return; }

    const words = args.split(/\s+/);
    let matchedLogs: any[] = [];

    for (let w = words.length; w >= 1; w--) {
      const candidate = words.slice(0, w).join(" ");
      const regexParts = words.slice(0, w).map((wd: string) =>
        `(?=.*${wd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`
      );
      const fuzzyRe = new RegExp(`^${regexParts.join("")}.*$`, "i");

      matchedLogs = await Log.find({
        userId: user._id,
        title: { $regex: fuzzyRe }
      }).lean();

      if (matchedLogs.length > 0) break;
    }

    if (matchedLogs.length === 0) {
      await ctx.reply(`❌ No log found matching <b>"${args}"</b>.`, { parse_mode: "HTML" });
      return;
    }

    if (matchedLogs.length === 1) {
      const log = matchedLogs[0]!;
      const server = (ctx as any).fastifyApp;
      const stateKey = `state:${telegramUser.id}`;

      await server.redis.set(stateKey, JSON.stringify({
        type: "CONFIRM_DELETE",
        logId: log._id.toString(),
        title: log.title,
      }), "EX", 120);

      const kbd = new InlineKeyboard()
        .text("Yes, delete", "delete:confirm").row()
        .text("Cancel", "delete:cancel");

      await ctx.reply(
        `🗑 <b>Delete "${log.title}"?</b>\nThis cannot be undone.`,
        { parse_mode: "HTML", reply_markup: kbd }
      );
      return;
    }

    const server = (ctx as any).fastifyApp;
    const stateKey = `state:${telegramUser.id}`;

    await server.redis.set(stateKey, JSON.stringify({
      type: "DELETE_PICK",
      logs: matchedLogs.slice(0, 5).map((l: any) => ({ _id: l._id.toString(), title: l.title })),
    }), "EX", 120);

    const kbd = new InlineKeyboard();
    matchedLogs.slice(0, 5).forEach((l: any, i: number) => {
      kbd.text(l.title, `deletepick:${l._id}`).row();
    });

    await ctx.reply(
      `🗑 <b>Which entry to delete?</b>`,
      { parse_mode: "HTML", reply_markup: kbd }
    );

  } catch (error) {
    console.error("Delete command error:", error);
    await ctx.reply("❌ Error processing delete request.");
  }
});

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
