import mongoose from "mongoose"
import fp from "fastify-plugin"
import { env } from "../config"

export default fp(async (fastify) => {
  try {
    mongoose.connection.on("connected", () => {
      fastify.log.info("MongoDB connection established successfully.");
    });

    mongoose.connection.on("error", (err) => {
      fastify.log.error(`MongoDB connection error: ${err.message}`);
    });

    mongoose.connection.on("disconnected", () => {
      fastify.log.warn("MongoDB connection disconnected.");
    });

    await mongoose.connect(env.MONGODB_URI);

    fastify.decorate("mongoose", mongoose);

    fastify.addHook("onClose", async () => {
      fastify.log.info("Closing MongoDB connection...");
      await mongoose.disconnect();
    });
  } catch (error) {
    fastify.log.error({err : error}, "Failed to initialize MongoDB connection:");
    process.exit(1);
  }
});