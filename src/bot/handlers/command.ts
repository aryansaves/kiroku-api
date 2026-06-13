import { Composer } from "grammy";
import { User } from "../../models/user";
import { Log } from "../../models/log";

export const commandsComposer = new Composer();

// Handle /start command execution loop
commandsComposer.command("start", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  const telegramIdStr = telegramUser.id.toString();

  try {
    // 1. Determine if a user entry already occupies a document slot
    let user = await User.findOne({ telegramId: telegramIdStr });

    if (user) {
      await ctx.reply(
        `Welcome back, ${user.displayName}! ✨\n\n` +
        `Your public media journal is live and active at:\n` +
        `👉 https://kiroku.com/u/${user.username}`
      );
      return;
    }

    // 2. First-time registration fallback logic: auto-generate structural profile parameters
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
      `Your personal media journal has been successfully initialized!\n\n` +
      `📖 Profile Page: https://kiroku.com/u/${user.username}\n\n` +
      `To change your custom web address link suffix, type:\n` +
      `/username your_new_name`
    );
  } catch (error) {
    console.error("Critical error during bot /start command sequencing:", error);
    await ctx.reply("❌ Infrastructure error occurred while initializing your journal profile space.");
  }
});

// Handle /username configuration updates
commandsComposer.command("username", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  // Extract argument payload parameters from string context array split
  const args = ctx.match?.trim();
  if (!args) {
    await ctx.reply("⚠️ Missing argument format pattern. Example utilization: `/username aryan`");
    return;
  }

  const targetUsername = args.toLowerCase();

  // Strict validation tracking parameters constraint execution
  const usernameRegex = /^[a-z0-9-]+$/;
  if (!usernameRegex.test(targetUsername) || targetUsername.length < 3 || targetUsername.length > 32) {
    await ctx.reply("❌ Invalid format. Usernames must be 3-32 alphanumeric characters or hyphens only.");
    return;
  }

  // Prevent hijacking system routes or core infrastructure reservation parameters
  const reservedKeywords = new Set(["www", "api", "admin", "auth", "static", "cdn", "kiroku", "internal"]);
  if (reservedKeywords.has(targetUsername)) {
    await ctx.reply("❌ This identifier string is an explicitly reserved infrastructure routing keyword.");
    return;
  }

  try {
    // Determine if the target handle choice is already claimed
    const existingUser = await User.findOne({ username: targetUsername });
    if (existingUser) {
      await ctx.reply("❌ This username handle choice is already fully claimed by another user profile.");
      return;
    }

    // Update username allocation parameters cleanly
    const updatedUser = await User.findOneAndUpdate(
      { telegramId: telegramUser.id.toString() },
      { username: targetUsername },
      { new: true }
    );

    if (!updatedUser) {
      await ctx.reply("❌ Profile not found. Please activate your account structure using the `/start` command first.");
      return;
    }

    await ctx.reply(`✅ Suffix updated successfully! Your journal page is now live at:\n👉 https://kiroku.com/u/${targetUsername}`);
  } catch (error) {
    console.error("Error modifying profile username configurations:", error);
    await ctx.reply("❌ Database connection error occurred while migrating your username handle choice.");
  }
});

// Handle /history command - Generates a raw text timeline of all personal logs
commandsComposer.command("history", async (ctx) => {
  const telegramUser = ctx.from;
  if (!telegramUser) return;

  await ctx.replyWithChatAction("typing");

  try {
    // 1. Resolve the Telegram user from the database
    const user = await User.findOne({ telegramId: telegramUser.id.toString() });
    if (!user) {
      await ctx.reply("❌ Account not found. Run /start first to initialize your journal.");
      return;
    }

    // 2. Fetch all logs for this user, excluding watchlists, sorted chronologically
    const logs = await Log.find({ 
      userId: user._id,
      status: { $ne: "planned" } // Exclude item states that are only watchlists
    })
    .sort({ createdAt: 1 }) // 1 = Oldest to Newest (Chronological journal flow)
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
    
    // 3. Format the log documents into a plain-text journal timeline string array
    const journalLines = logs.map((log : ILog) => {
      const date = new Date(log.createdAt);
      
      // Format to DD-MM-YYYY HH:MM to match your specifications exactly
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      
      const timestamp = `${day}-${month}-${year} ${hours}:${minutes}`;

      // Build context verbs dynamically based on media type mapping rules
      let verb = "consumed";
      if (log.mediaType === "anime" || log.mediaType === "movie") verb = "watched";
      if (log.mediaType === "book" || log.mediaType === "manga") verb = "read";
      if (log.mediaType === "game") verb = "played";
      if (log.mediaType === "music" || log.mediaType === "podcast") verb = "listened to";

      // Append notes text context if the log contains extra user commentary
      const notesContext = log.notes ? ` and noted: "${log.notes}"` : "";
      const ratingContext = log.rating ? ` (${log.rating}/10)` : "";

      return `📅 ${timestamp} — I ${verb} *${log.title}*${ratingContext}${notesContext}`;
    });

    // 4. Construct the final message string wrapper payload
    const header = `📖 *${user.displayName}'s Personal Media Journal*\n───────────────────\n\n`;
    const fullHistoryMessage = header + journalLines.join("\n\n");

    // Telegram has a hard limit of 4096 characters per single text block message.
    // If your journal history grows massive, trim it or break it down safely.
    if (fullHistoryMessage.length > 4000) {
      await ctx.reply(
        "📝 Your history is too long for a single message! " +
        `You can view your full visual timeline on the web at:\n👉 https://kiroku.com/u/${user.username}`
      );
      return;
    }

    await ctx.reply(fullHistoryMessage, { parse_mode: "Markdown" });

  } catch (error) {
    console.error("Error executing bot history timeline fetch:", error);
    await ctx.reply("❌ An infrastructure error occurred while compiling your journal history.");
  }
});