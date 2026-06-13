import { Bot } from "grammy";
import { env } from "../config";
import { commandsComposer } from "./handlers/command";
import { messageComposer, callbackComposer } from "./handlers/messages";
import type { FastifyInstance } from "fastify";

export function initializeBot(fastify: FastifyInstance): Bot {
  // Instantiate Grammy bot with your secure BotFather token credential
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // Middleware extension: Inject your server instance into every incoming Telegram update cycle
  bot.use(async (ctx, next) => {
    (ctx as any).fastifyApp = fastify;
    await next();
  });

  // Mount your modular orchestration pipelines
  bot.use(commandsComposer);
  bot.use(callbackComposer);
  bot.use(messageComposer);  

  // Catch block to ensure runtime exceptions do not crash your global process thread
  bot.catch((err) => {
    fastify.log.error({ err: err.error }, `Grammy bot encountered a processing exception during update: ${err.ctx.update.update_id}`);
  });

  return bot;
}