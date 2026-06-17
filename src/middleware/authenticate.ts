import type { FastifyRequest, FastifyReply } from "fastify";

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
      });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return reply.status(401).send({
        error: "Unauthorized",
        message: "Access token missing from Bearer schema.",
      });
    }

    const decoded = request.server.jwt.verify<{ userId: string }>(token);
    
    request.userId = decoded.userId;
  } catch (error) {
    return reply.status(401).send({
      error: "Unauthorized",
      message: "Provided access token is invalid or has expired.",
    });
  }
}

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
  }
}