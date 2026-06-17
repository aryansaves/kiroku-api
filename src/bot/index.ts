import { Bot } from "grammy";
import { env } from "../config";
import { commandsComposer } from "./handlers/command";
import { messageComposer, callbackComposer } from "./handlers/messages";
import type { FastifyInstance } from "fastify";

export function initializeBot(fastify: FastifyInstance): Bot {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  bot.api.setMyCommands([
    { command: "start", description: "Create your journal account" },
    { command: "log", description: "Browse your journal entries" },
    { command: "delete", description: "Remove a log entry" },
    { command: "username", description: "Set your profile URL" },
    { command: "help", description: "Show all commands and guide" },
  ]).catch(() => {});

  bot.use(async (ctx, next) => {
    (ctx as any).fastifyApp = fastify;
    await next();
  });

  bot.use(commandsComposer);
  bot.use(callbackComposer);
  bot.use(messageComposer);  

  bot.catch((err) => {
    fastify.log.error({ err: err.error }, `Grammy bot encountered a processing exception during update: ${err.ctx.update.update_id}`);
  });

  return bot;
}