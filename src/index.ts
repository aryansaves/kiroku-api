import { authenticate } from "./middleware/authenticate";

fastify.get("/users/me/profile", { preHandler: [authenticate] }, async (request, reply) => {
  return {
    message: "Welcome to your protected area.",
    authenticatedUserId: request.userId, // Accessible because of the request interface extension
  };
});